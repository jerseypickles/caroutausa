import { Router } from 'express';
import { VideoClip } from '../models/videoClip.js';
import { Product } from '../models/product.js';
import { pickRefs } from '../refs.js';
import { generateVideoFrames, animateClip, finishAnimation, MOTION_PRESETS } from '../video.js';
import { piapiConfigured } from '../piapi.js';

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
videoRouter.get('/video/:id/video', async (req, res) => {
  const doc = await VideoClip.findById(req.params.id).select('+videoData videoUrl').lean();
  if (doc?.videoData) {
    res.set('Content-Type', 'video/mp4');
    return res.send(Buffer.from(doc.videoData, 'base64'));
  }
  if (doc?.videoUrl) return res.redirect(doc.videoUrl);
  res.status(404).json({ error: 'Sin video' });
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

videoRouter.delete('/video/:id', async (req, res) => {
  await VideoClip.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
