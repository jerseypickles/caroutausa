import { Router } from 'express';
import { VideoClip } from '../models/videoClip.js';
import { Product } from '../models/product.js';
import { pickRefs } from '../refs.js';
import { generateVideoFrames, animateClip, finishAnimation, MOTION_PRESETS } from '../video.js';
import { overlayHookVideo } from '../videoproc.js';
import { piapiConfigured } from '../piapi.js';
import * as meta from '../meta.js';
import { MetaCampaign } from '../models/metaCampaign.js';
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

// Lanza el video a Meta: sube el mp4 + crea campaña/adset/ad PAUSADO con SHOP_NOW al producto.
// NO activa (queda pausado para que el usuario lo prenda cuando quiera).
videoRouter.post('/video/:id/launch', async (req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no está configurado' });
  const clip = await VideoClip.findById(req.params.id).lean();
  if (!clip) return res.status(404).json({ error: 'clip no encontrado' });
  if (clip.stage !== 'ready') return res.status(400).json({ error: 'el video no está listo (ready)' });
  if (clip.metaAdId) return res.status(400).json({ error: 'este video ya fue lanzado' });
  let campaignId = null;
  try {
    const prod = clip.shopifyProductId ? await Product.findOne({ shopifyId: clip.shopifyProductId }).lean() : null;
    const link = productLink(prod?.handle);
    const base = config.publicBaseUrl.replace(/\/$/, '');
    const igActorId = await meta.getIgActorId();
    // 1) subir el video a Meta (por URL) + esperar a que lo procese.
    const videoId = await meta.uploadVideo({ fileUrl: `${base}/api/video/${clip._id}/video` });
    let st = 'processing';
    for (let i = 0; i < 30 && st !== 'ready'; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      st = await meta.getVideoStatus(videoId).catch(() => 'processing');
      if (st === 'error') throw new Error('Meta no pudo procesar el video');
    }
    if (st !== 'ready') throw new Error('el video sigue procesándose en Meta — reintentá en un minuto');
    // 2) creative de video + cadena campaña/adset/ad (PAUSED).
    const name = `CAROTA VIDEO · ${clip.product} · ${clip.hookLine || 'fit-check'}`.slice(0, 90);
    const creative = await meta.createVideoCreative({ name, videoId, thumbUrl: `${base}/api/video/${clip._id}/start-frame`, link, message: clip.hookLine ? `${clip.hookLine} 🔥` : '', igActorId });
    const campaign = await meta.createCampaign({ name }); campaignId = campaign.id;
    const adSet = await meta.createAdSet({ name: name + ' · adset', campaignId: campaign.id, dailyBudgetCents: 1000, optimizationEvent: req.body?.optimizationEvent || 'ADD_TO_CART' });
    const ad = await meta.createAd({ name: name + ' · ad', adsetId: adSet.id, creativeId: creative.id });
    await MetaCampaign.create({ campaignId: campaign.id, name, status: 'PAUSED', ads: [{ adId: ad.id, creativeId: clip._id, format: 'video' }] });
    await VideoClip.findByIdAndUpdate(clip._id, { metaAdId: ad.id, metaCampaignId: campaign.id });
    res.json({ ok: true, campaignId: campaign.id, adId: ad.id, status: 'PAUSED', note: 'Creado PAUSADO. Activalo en Meta / Ad Manager cuando quieras.' });
  } catch (err) {
    if (campaignId) { try { await meta.deleteObject(campaignId); } catch { /* noop */ } }
    res.status(502).json({ error: err.message });
  }
});

videoRouter.delete('/video/:id', async (req, res) => {
  await VideoClip.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
