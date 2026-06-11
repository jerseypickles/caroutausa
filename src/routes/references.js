import { Router } from 'express';
import { Reference } from '../models/reference.js';
import { extractAndStore } from '../refs.js';

export const referencesRouter = Router();

// GET /api/references -> biblioteca de pins (sin imageData)
referencesRouter.get('/references', async (_req, res) => {
  const references = await Reference.find().sort({ createdAt: -1 }).lean();
  const activeCount = references.filter((r) => r.active).length;
  res.json({ references, activeCount });
});

// POST /api/references  body: { imageB64, label? } -> agrega un pin
referencesRouter.post('/references', async (req, res) => {
  const { imageB64, label, type } = req.body || {};
  if (!imageB64) return res.status(400).json({ error: 'Falta imageB64' });
  const t = ['outfit', 'scene', 'pose'].includes(type) ? type : 'outfit';
  const ref = await Reference.create({ imageData: imageB64, label: label || '', type: t, active: true });
  await extractAndStore(ref._id).catch((e) => console.error('[refs] extract on upload:', e.message)); // analiza ya
  res.status(201).json({ id: ref._id, label: ref.label, active: ref.active, type: ref.type });
});

// POST /api/references/:id/reextract -> re-analiza la referencia (struct nuevo)
referencesRouter.post('/references/:id/reextract', async (req, res) => {
  const ext = await extractAndStore(req.params.id).catch(() => null);
  if (!ext) return res.status(404).json({ error: 'No se pudo analizar' });
  res.json({ dna: ext.struct, brief: ext.brief });
});

// GET /api/references/:id/image -> sirve el pin
referencesRouter.get('/references/:id/image', async (req, res) => {
  const doc = await Reference.findById(req.params.id).select('+imageData').lean();
  if (!doc || !doc.imageData) return res.status(404).json({ error: 'Sin imagen' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(doc.imageData, 'base64'));
});

// PATCH /api/references/:id  body: { active?, label?, type?, favorite?, avoid? }
referencesRouter.patch('/references/:id', async (req, res) => {
  const b = req.body || {};
  const update = {};
  if (typeof b.active === 'boolean') update.active = b.active;
  if (typeof b.label === 'string') update.label = b.label;
  if (typeof b.favorite === 'boolean') update.favorite = b.favorite;
  if (typeof b.avoid === 'boolean') update.avoid = b.avoid;
  const typeChanged = ['outfit', 'scene', 'pose'].includes(b.type);
  if (typeChanged) { update.type = b.type; update.styleDna = ''; update.dna = null; }
  const doc = await Reference.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'Referencia no encontrada' });
  if (typeChanged) await extractAndStore(doc._id).catch((e) => console.error('[refs] re-extract:', e.message)); // re-analiza con el nuevo tipo
  res.json({ reference: { _id: doc._id } });
});

// DELETE /api/references/:id
referencesRouter.delete('/references/:id', async (req, res) => {
  const doc = await Reference.findByIdAndDelete(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Referencia no encontrada' });
  res.json({ ok: true });
});
