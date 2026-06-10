import { Router } from 'express';
import { Carousel } from '../models/carousel.js';
import { Product } from '../models/product.js';
import { pickRefs } from '../refs.js';
import { generateCarouselInBackground } from '../carousel.js';
import { analyzeImage } from '../analyzer.js';

export const carouselsRouter = Router();

// POST /api/carousels/:id/analyze -> analiza el hero card (lazy, cacheado)
carouselsRouter.post('/carousels/:id/analyze', async (req, res) => {
  const doc = await Carousel.findById(req.params.id).select('+cards.imageData').lean();
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  if (doc.analysis?.status === 'done') return res.json({ analysis: doc.analysis });
  const hero = doc.cards?.[0]?.imageData;
  if (!hero) return res.status(400).json({ error: 'Sin imagen para analizar' });
  try {
    const analysis = await analyzeImage({ b64: hero, product: doc.product, wash: doc.wash });
    await Carousel.findByIdAndUpdate(doc._id, { analysis });
    res.json({ analysis });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

// POST /api/products/:id/carousel -> crea un carrusel cohesivo (5 cards) en background.
carouselsRouter.post('/products/:id/carousel', async (req, res) => {
  const product = await Product.findOne({ shopifyId: Number(req.params.id) }).lean();
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (!product.image) return res.status(400).json({ error: 'El producto no tiene imagen' });

  // hero usa una referencia NUEVA (no usada por el producto) para el vibe del outfit
  const [ref] = await pickRefs({ shopifyProductId: product.shopifyId, n: 1 });

  const doc = await Carousel.create({
    shopifyProductId: product.shopifyId,
    product: product.title,
    wash: product.wash,
    sourceImageUrl: product.image,
    hasReference: Boolean(ref),
    referenceId: ref?.id || null,
    referenceDna: ref?.dna || '',
    referenceImageData: ref?.b64 || null,
    genStatus: 'generating',
  });

  generateCarouselInBackground(doc._id);

  await Product.updateOne({ shopifyId: product.shopifyId }, { $inc: { generatedCount: 3 }, $set: { lastGeneratedAt: new Date() } });
  res.status(202).json({ id: doc._id, status: 'generating' });
});

// GET /api/carousels -> lista para la QC (sin imageData)
carouselsRouter.get('/carousels', async (_req, res) => {
  const carousels = await Carousel.find().sort({ createdAt: -1 }).lean();
  // metadata de cards sin la imagen
  const out = carousels.map((c) => ({
    ...c,
    cards: (c.cards || []).map((cd) => ({ role: cd.role, order: cd.order, fidelityScore: cd.fidelityScore, fidelityVerdict: cd.fidelityVerdict })),
  }));
  res.json({ carousels: out });
});

// GET /api/carousels/:id/cards/:idx/image -> sirve la imagen de una card
carouselsRouter.get('/carousels/:id/cards/:idx/image', async (req, res) => {
  const doc = await Carousel.findById(req.params.id).select('+cards.imageData').lean();
  const card = doc?.cards?.[Number(req.params.idx)];
  if (!card?.imageData) return res.status(404).json({ error: 'Sin imagen' });
  const buf = Buffer.from(card.imageData, 'base64');
  res.set('Content-Type', detectMime(buf));
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
});

// GET /api/carousels/:id/reference -> sirve la referencia de estilo usada
carouselsRouter.get('/carousels/:id/reference', async (req, res) => {
  const doc = await Carousel.findById(req.params.id).select('+referenceImageData').lean();
  if (!doc?.referenceImageData) return res.status(404).json({ error: 'Sin referencia' });
  const buf = Buffer.from(doc.referenceImageData, 'base64');
  res.set('Content-Type', detectMime(buf));
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
});

// PATCH /api/carousels/:id/qc
carouselsRouter.patch('/carousels/:id/qc', async (req, res) => {
  const { qcStatus, qcNotes } = req.body || {};
  if (!['approved', 'rejected'].includes(qcStatus)) return res.status(400).json({ error: 'qcStatus invalido' });
  const update = { qcStatus, qcNotes };
  const doc = await Carousel.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json({ qcStatus });
});

// PATCH /api/carousels/:id/copy
carouselsRouter.patch('/carousels/:id/copy', async (req, res) => {
  const { primaryText, headline } = req.body || {};
  const update = { 'copy.edited': true };
  if (typeof primaryText === 'string') update['copy.primaryText'] = primaryText;
  if (typeof headline === 'string') update['copy.headline'] = headline;
  const doc = await Carousel.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) return res.status(404).json({ error: 'No encontrado' });
  res.json({ copy: doc.copy });
});
