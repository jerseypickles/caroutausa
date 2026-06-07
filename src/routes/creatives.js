import { Router } from 'express';
import { Creative } from '../models/creative.js';

export const creativesRouter = Router();

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
  const doc = await Creative.findById(req.params.id).select('+imageData').lean();
  if (!doc || !doc.imageData) {
    return res.status(404).json({ error: 'Sin imagen para este creative' });
  }
  const buffer = Buffer.from(doc.imageData, 'base64');
  res.set('Content-Type', 'image/png');
  // La imagen de un creative no cambia una vez generada -> cacheable e inmutable.
  // Evita que el polling del panel la re-descargue y parpadee.
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buffer);
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
