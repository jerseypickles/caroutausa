import { Router } from 'express';
import { Reference } from '../models/reference.js';

export const referencesRouter = Router();

// GET /api/references -> biblioteca de pins (sin imageData)
referencesRouter.get('/references', async (_req, res) => {
  const references = await Reference.find().sort({ createdAt: -1 }).lean();
  const activeCount = references.filter((r) => r.active).length;
  res.json({ references, activeCount });
});

// POST /api/references  body: { imageB64, label? } -> agrega un pin
referencesRouter.post('/references', async (req, res) => {
  const { imageB64, label } = req.body || {};
  if (!imageB64) return res.status(400).json({ error: 'Falta imageB64' });
  const ref = await Reference.create({ imageData: imageB64, label: label || '', active: true });
  res.status(201).json({ id: ref._id, label: ref.label, active: ref.active });
});

// GET /api/references/:id/image -> sirve el pin
referencesRouter.get('/references/:id/image', async (req, res) => {
  const doc = await Reference.findById(req.params.id).select('+imageData').lean();
  if (!doc || !doc.imageData) return res.status(404).json({ error: 'Sin imagen' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(doc.imageData, 'base64'));
});

// PATCH /api/references/:id  body: { active?, label? }
referencesRouter.patch('/references/:id', async (req, res) => {
  const update = {};
  if (typeof req.body?.active === 'boolean') update.active = req.body.active;
  if (typeof req.body?.label === 'string') update.label = req.body.label;
  const doc = await Reference.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'Referencia no encontrada' });
  res.json({ reference: { _id: doc._id, label: doc.label, active: doc.active } });
});

// DELETE /api/references/:id
referencesRouter.delete('/references/:id', async (req, res) => {
  const doc = await Reference.findByIdAndDelete(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Referencia no encontrada' });
  res.json({ ok: true });
});
