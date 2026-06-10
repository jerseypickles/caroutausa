import { Router } from 'express';
import { Creative } from '../models/creative.js';
import { analyzeImage } from '../analyzer.js';
import { buildCopyUpdate } from '../copy.js';

export const creativesRouter = Router();

// POST /api/creatives/:id/analyze -> Creative Analyzer (lazy, cacheado)
creativesRouter.post('/creatives/:id/analyze', async (req, res) => {
  const doc = await Creative.findById(req.params.id).select('+imageData').lean();
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  if (doc.analysis?.status === 'done') return res.json({ analysis: doc.analysis });
  if (!doc.imageData) return res.status(400).json({ error: 'Sin imagen para analizar' });
  try {
    const analysis = await analyzeImage({ b64: doc.imageData, product: doc.product, wash: doc.wash });
    await Creative.findByIdAndUpdate(doc._id, { analysis });
    res.json({ analysis });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Detecta el formato real por magic bytes (las viejas son png, las nuevas webp).
function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

// GET /api/creatives?drop=&wash=&qcStatus=
// Lista creatives para el panel de QC (sin imageData, va aparte por /image).
creativesRouter.get('/creatives', async (req, res) => {
  const { drop, wash, qcStatus } = req.query;
  const filter = {};
  if (drop) filter.drop = drop;
  if (wash) filter.wash = wash;
  if (qcStatus) filter.qcStatus = qcStatus;

  const creatives = await Creative.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ creatives });
});

// GET /api/creatives/:id/image -> sirve el PNG del preview (imageData base64).
creativesRouter.get('/creatives/:id/image', async (req, res) => {
  const doc = await Creative.findById(req.params.id).select('+imageData +feedImageData +squareImageData').lean();
  // p=feed -> 4:5; p=square -> 1:1; default -> story 9:16. Fallback al story si falta.
  const data = req.query.p === 'feed' ? (doc?.feedImageData || doc?.imageData)
    : req.query.p === 'square' ? (doc?.squareImageData || doc?.imageData)
    : doc?.imageData;
  if (!doc || !data) {
    return res.status(404).json({ error: 'Sin imagen para este creative' });
  }
  const buffer = Buffer.from(data, 'base64');
  res.set('Content-Type', detectMime(buffer));
  // La imagen de un creative no cambia una vez generada -> cacheable e inmutable.
  // Evita que el polling del panel la re-descargue y parpadee.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buffer);
});

// GET /api/creatives/:id/reference -> sirve el pin de referencia usado (si hubo).
creativesRouter.get('/creatives/:id/reference', async (req, res) => {
  const doc = await Creative.findById(req.params.id).select('+referenceImageData').lean();
  if (!doc || !doc.referenceImageData) {
    return res.status(404).json({ error: 'Sin referencia para este creative' });
  }
  const refBuf = Buffer.from(doc.referenceImageData, 'base64');
  res.set('Content-Type', detectMime(refBuf));
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(refBuf);
});

// PATCH /api/creatives/:id/copy  body: { primaryTexts?: [], headlines?: [] } (o singular legacy)
creativesRouter.patch('/creatives/:id/copy', async (req, res) => {
  const update = buildCopyUpdate(req.body || {});
  const doc = await Creative.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'Creative no encontrado' });
  res.json({ copy: doc.copy });
});

// PATCH /api/creatives/:id/qc  body: { qcStatus: "approved"|"rejected", qcNotes? }
// Marca el resultado del QC humano. Al rechazar, limpia imageData (no guardamos
// storage de lo que se descarta). Al aprobar, se conserva hasta migrar a R2.
creativesRouter.patch('/creatives/:id/qc', async (req, res) => {
  const { qcStatus, qcNotes } = req.body || {};
  if (!['approved', 'rejected'].includes(qcStatus)) {
    return res.status(400).json({ error: 'qcStatus debe ser "approved" o "rejected"' });
  }

  const update = { qcStatus, qcNotes };
  if (qcStatus === 'rejected') update.imageData = null;

  const doc = await Creative.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) {
    return res.status(404).json({ error: 'Creative no encontrado' });
  }
  res.json({ creative: doc });
});
