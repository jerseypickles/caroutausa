import { Router } from 'express';
import { VideoClip } from '../models/videoClip.js';
import { Product } from '../models/product.js';
import { pickRefs } from '../refs.js';
import { generateVideoFrames, animateClip, finishAnimation, MOTION_PRESETS, SHOT_TYPES, createEditProject, buildProjectEdit } from '../video.js';
import { overlayHookVideo } from '../videoproc.js';
import { buildJeansEdit } from '../videoedit.js';
import { EditProject } from '../models/editProject.js';
import { piapiConfigured } from '../piapi.js';
import * as meta from '../meta.js';
import { MetaCampaign } from '../models/metaCampaign.js';
import { buildCopyUpdate } from '../copy.js';
import { config } from '../config.js';

function productLink(handle) { return handle ? `${config.storeUrl}/products/${handle}` : config.storeUrl; }

export const videoRouter = Router();

// Lista de clips (sin las imágenes pesadas) — para el tab por etapas.
videoRouter.get('/video', async (req, res) => {
  const clips = await VideoClip.find().sort({ createdAt: -1 }).limit(120)
    .select('-startImageData -lastImageData -videoData -referenceImageData').lean();
  res.json({ clips, piapi: piapiConfigured(), presets: Object.keys(MOTION_PRESETS) });
});

// Crea un clip: elige ref + producto, genera start+last frames en background.
videoRouter.post('/video/generate', async (req, res) => {
  const { shopifyProductId } = req.body || {};
  const product = shopifyProductId
    ? await Product.findOne({ shopifyId: Number(shopifyProductId) }).lean()
    : await Product.findOne().sort({ generatedCount: 1 }).lean();
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  const [ref] = await pickRefs({ shopifyProductId: product.shopifyId, wash: product.wash, n: 1, type: 'outfit' });
  const clip = await VideoClip.create({
    shopifyProductId: product.shopifyId, product: product.title, wash: product.wash,
    sourceImageUrl: product.image,
    referenceId: ref?.id || null, referenceDna: ref?.dna || '', referenceImageData: ref?.b64 || null,
    stage: 'frames', genStatus: 'generating',
  });
  generateVideoFrames(clip._id).catch((e) => console.error('[video] frames job:', e.message));
  res.status(201).json({ id: clip._id, status: 'generating' });
});

// Frames PÚBLICOS (PiAPI los baja). Sirven el webp.
async function serveFrame(field, req, res) {
  const doc = await VideoClip.findById(req.params.id).select('+' + field).lean();
  const data = doc?.[field];
  if (!data) return res.status(404).json({ error: 'Sin frame' });
  res.set('Content-Type', 'image/webp');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(data, 'base64'));
}
videoRouter.get('/video/:id/start-frame', (req, res) => serveFrame('startImageData', req, res));
videoRouter.get('/video/:id/last-frame', (req, res) => serveFrame('lastImageData', req, res));

// El mp4 final (de nuestra copia, o redirige a la URL de Seedance).
// ?dl=1 -> fuerza descarga real (Content-Disposition attachment). Sin eso, Safari abre el
// video inline y al "Guardar como" baja un archivo parcial/roto. Con attachment baja completo.
videoRouter.get('/video/:id/video', async (req, res) => {
  const doc = await VideoClip.findById(req.params.id).select('+videoData videoUrl').lean();
  const dl = req.query.dl || req.query.download;
  if (doc?.videoData) {
    const buf = Buffer.from(doc.videoData, 'base64');
    res.set('Content-Type', 'video/mp4');
    res.set('Content-Length', String(buf.length));
    res.set('Accept-Ranges', 'bytes');
    if (dl) res.set('Content-Disposition', `attachment; filename="carota-${req.params.id}.mp4"`);
    return res.send(buf);
  }
  if (doc?.videoUrl) {
    // Seedance: para descarga, hacemos proxy del mp4 con header attachment (un redirect a la URL
    // de Seedance abre inline en el navegador y vuelve a romper el "Guardar como").
    if (dl) {
      try {
        const r = await fetch(doc.videoUrl);
        if (!r.ok) return res.redirect(doc.videoUrl);
        const buf = Buffer.from(await r.arrayBuffer());
        res.set('Content-Type', 'video/mp4');
        res.set('Content-Length', String(buf.length));
        res.set('Content-Disposition', `attachment; filename="carota-${req.params.id}.mp4"`);
        return res.send(buf);
      } catch { return res.redirect(doc.videoUrl); }
    }
    return res.redirect(doc.videoUrl);
  }
  res.status(404).json({ error: 'Sin video' });
});

// PROTOTIPO Edit Builder: arma un edit de cortes rápidos cambiando jeans a partir de clips ya
// listos (de washes distintos), con beat sintetizado + hook. Background (ffmpeg tarda ~40s).
videoRouter.post('/video/edit-test', async (req, res) => {
  const { clipIds, hookLine, callout, bpm } = req.body || {};
  // Elige clips listos con video; prioriza washes DISTINTOS para que se note el cambio de jean.
  const q = { stage: 'ready', isEdit: { $ne: true }, videoData: { $ne: null } };
  if (Array.isArray(clipIds) && clipIds.length) q._id = { $in: clipIds };
  const ready = await VideoClip.find(q).sort({ createdAt: -1 }).select('+videoData wash product callout videoUrl').limit(40).lean();
  if (ready.length < 2) return res.status(400).json({ error: 'Necesito al menos 2 videos listos' });
  // dedupe por wash (1 por wash) hasta 5; si faltan, completa con los demás.
  const seen = new Set(); const picked = [];
  for (const c of ready) { const w = c.wash || c._id; if (!seen.has(w)) { seen.add(w); picked.push(c); } if (picked.length >= 5) break; }
  for (const c of ready) { if (picked.length >= 5) break; if (!picked.find((p) => String(p._id) === String(c._id))) picked.push(c); }
  const sources = picked.slice(0, 5);

  const edit = await VideoClip.create({
    isEdit: true, editFrom: sources.map((c) => String(c._id)),
    product: 'EDIT · jeans cambiando', wash: 'multi',
    hookLine: hookLine || 'WHICH WASH?', callout: callout || `${sources.length} FITS · CAROTA`,
    motionPreset: 'multi-edit', stage: 'animating', genStatus: 'generating', duration: 11,
  });
  res.status(201).json({ id: edit._id, status: 'building', sources: sources.length });

  // build en background
  (async () => {
    try {
      // Fuente CRUDA (sin hook bakeado): el mp4 de Seedance (videoUrl). Así el edit lleva UN solo
      // hook limpio y conserva la calidad original. Fallback a nuestra copia si la URL ya expiró.
      const clips = [];
      for (const c of sources) {
        let buffer = null;
        if (c.videoUrl) {
          try { const rr = await fetch(c.videoUrl); if (rr.ok) buffer = Buffer.from(await rr.arrayBuffer()); } catch {}
        }
        if (!buffer && c.videoData) buffer = Buffer.from(c.videoData, 'base64');
        if (buffer) clips.push({ buffer, wash: c.wash });
      }
      if (clips.length < 2) throw new Error('no pude bajar los videos crudos (URLs expiradas)');
      const r = await buildJeansEdit({
        clips, hookLine: edit.hookLine, callout: edit.callout, bpm: Number(bpm) || 100, targetSec: 11,
      });
      const b64 = r.buffer.toString('base64');
      if (b64.length > 15.5 * 1024 * 1024) throw new Error(`edit muy pesado (${(r.buffer.length / 1e6).toFixed(1)}MB) para guardar`);
      await VideoClip.findByIdAndUpdate(edit._id, {
        videoData: b64, duration: r.duration, stage: 'ready', genStatus: 'ready',
      });
      console.log(`[edit] listo ${edit._id}: ${r.segments} cortes, ${r.duration}s, ${r.bpm}bpm`);
    } catch (e) {
      await VideoClip.findByIdAndUpdate(edit._id, { stage: 'failed', genStatus: 'failed', error: e.message });
      console.error('[edit] fallo:', e.message);
    }
  })();
});

// ============ FLUJO POR-JEAN (Edits) ============

// Lista de proyectos de edit (con el estado de cada toma para la tira del tab).
videoRouter.get('/edits', async (_req, res) => {
  const projects = await EditProject.find().sort({ createdAt: -1 }).limit(60)
    .select('-editVideoData -copy').lean();
  // adjunta el estado de cada toma (shot)
  const allShotIds = projects.flatMap((p) => p.shotIds || []);
  const shots = await VideoClip.find({ _id: { $in: allShotIds } })
    .select('shotType stage genStatus startFidelity videoQc editProjectId').lean();
  const byProj = {};
  for (const s of shots) { (byProj[s.editProjectId] ||= []).push(s); }
  const out = projects.map((p) => ({ ...p, shots: (byProj[p._id] || []) }));
  res.json({ projects: out, shotTypes: Object.fromEntries(Object.entries(SHOT_TYPES).map(([k, v]) => [k, v.label])) });
});

// Crea un proyecto (1 jean -> N tomas).
videoRouter.post('/edits', async (req, res) => {
  try {
    const r = await createEditProject({ shopifyProductId: req.body?.shopifyProductId, shotTypes: req.body?.shotTypes });
    res.status(201).json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Sirve el mp4 del edit (con ?dl=1 para descarga forzada).
videoRouter.get('/edits/:id/video', async (req, res) => {
  const doc = await EditProject.findById(req.params.id).select('+editVideoData').lean();
  if (!doc?.editVideoData) return res.status(404).json({ error: 'Sin edit' });
  const buf = Buffer.from(doc.editVideoData, 'base64');
  res.set('Content-Type', 'video/mp4');
  res.set('Content-Length', String(buf.length));
  res.set('Accept-Ranges', 'bytes');
  if (req.query.dl || req.query.download) res.set('Content-Disposition', `attachment; filename="carota-edit-${req.params.id}.mp4"`);
  res.send(buf);
});

// Arma el edit (background — ffmpeg + bajar tomas crudas tarda).
videoRouter.post('/edits/:id/build', async (req, res) => {
  const doc = await EditProject.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'no encontrado' });
  const ready = await VideoClip.countDocuments({ _id: { $in: doc.shotIds }, stage: 'ready' });
  if (ready < 2) return res.status(400).json({ error: `solo ${ready} toma(s) lista(s) — esperá a que estén al menos 2` });
  res.status(202).json({ id: req.params.id, status: 'building' });
  buildProjectEdit(req.params.id, { bpm: req.body?.bpm }).catch((e) => console.error('[edit] build:', e.message));
});

videoRouter.post('/edits/:id/accept', async (req, res) => {
  const doc = await EditProject.findByIdAndUpdate(req.params.id, { qcStatus: 'approved' }, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'no encontrado' });
  res.json({ ok: true, qcStatus: doc.qcStatus });
});
videoRouter.post('/edits/:id/unaccept', async (req, res) => {
  await EditProject.findByIdAndUpdate(req.params.id, { qcStatus: 'generated' });
  res.json({ ok: true });
});

videoRouter.delete('/edits/:id', async (req, res) => {
  const doc = await EditProject.findById(req.params.id).lean();
  if (doc) await VideoClip.deleteMany({ _id: { $in: doc.shotIds } }); // borra también las tomas
  await EditProject.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Curar: pasa de frames -> curated (gate humano antes de gastar Seedance).
videoRouter.post('/video/:id/curate', async (req, res) => {
  const doc = await VideoClip.findByIdAndUpdate(req.params.id, { stage: 'curated' }, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json({ id: doc._id, stage: doc.stage });
});

// Animar: manda start+last a Seedance.
videoRouter.post('/video/:id/animate', async (req, res) => {
  try {
    const preset = (req.body || {}).preset || 'mirror-sway';
    const taskId = await animateClip(req.params.id, { preset });
    res.json({ id: req.params.id, taskId, stage: 'animating' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Empuja el polleo manual de una task (además del cron).
videoRouter.post('/video/:id/refresh', async (req, res) => {
  try { const r = await finishAnimation(req.params.id); res.json(r); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// QC del video: pass/fail manual.
videoRouter.post('/video/:id/qc', async (req, res) => {
  const { status, notes } = req.body || {};
  const ok = status === 'pass';
  const doc = await VideoClip.findByIdAndUpdate(req.params.id, {
    'videoQc.status': ok ? 'pass' : 'fail', 'videoQc.notes': notes || '',
    stage: ok ? 'ready' : 'failed', qcStatus: ok ? 'approved' : 'rejected',
  }, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json({ id: doc._id, stage: doc.stage });
});

// Re-aplica el hook overlay al video guardado (para clips que quedaron sin hook).
videoRouter.post('/video/:id/rehook', async (req, res) => {
  const doc = await VideoClip.findById(req.params.id).select('+videoData').lean();
  if (!doc?.videoData || !doc.hookLine) return res.status(400).json({ error: 'sin video o sin hook' });
  try {
    const hooked = await overlayHookVideo(Buffer.from(doc.videoData, 'base64'), { hookLine: doc.hookLine, callout: doc.callout || '' });
    await VideoClip.findByIdAndUpdate(req.params.id, { videoData: hooked.toString('base64') });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ACEPTAR un video -> qcStatus 'approved' -> aparece en el Ad Manager (para armar el adset).
videoRouter.post('/video/:id/accept', async (req, res) => {
  const doc = await VideoClip.findByIdAndUpdate(req.params.id, { qcStatus: 'approved' }, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'no encontrado' });
  res.json({ ok: true, qcStatus: doc.qcStatus });
});
// Des-aceptar (volver a solo-listo).
videoRouter.post('/video/:id/unaccept', async (req, res) => {
  await VideoClip.findByIdAndUpdate(req.params.id, { qcStatus: 'generated' });
  res.json({ ok: true });
});
// Editar el copy del video (primary texts + headlines).
videoRouter.post('/video/:id/copy', async (req, res) => {
  const update = buildCopyUpdate(req.body || {});
  const doc = await VideoClip.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select('copy').lean();
  if (!doc) return res.status(404).json({ error: 'no encontrado' });
  res.json({ copy: doc.copy });
});

videoRouter.delete('/video/:id', async (req, res) => {
  await VideoClip.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
