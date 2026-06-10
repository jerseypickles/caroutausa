import { Router } from 'express';
import { Product } from '../models/product.js';
import { syncProducts } from '../sync.js';
import { enqueueJobs, enqueueFlatlay } from '../generation.js';
import { pickRefs } from '../refs.js';
import { config } from '../config.js';

export const productsRouter = Router();

// POST /api/products/:id/flatlay -> packshot still-life del producto (sin modelo).
productsRouter.post('/products/:id/flatlay', async (req, res) => {
  const product = await Product.findOne({ shopifyId: Number(req.params.id) }).lean();
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (!product.image) return res.status(400).json({ error: 'El producto no tiene imagen' });
  const doc = await enqueueFlatlay({
    imageUrl: product.image,
    productDescription: [product.title, product.description].filter(Boolean).join('. '),
    fitSpec: product.fitSpec || '',
    meta: { shopifyProductId: product.shopifyId, product: product.title, wash: product.wash, fitSpec: product.fitSpec || '' },
  });
  await Product.updateOne({ shopifyId: product.shopifyId }, { $inc: { generatedCount: 1 }, $set: { lastGeneratedAt: new Date() } });
  res.status(202).json({ id: doc._id, format: 'flatlay', status: 'generating' });
});

// GET /api/products -> productos sincronizados de Shopify (desde Mongo).
// isNew = aun no se genero ninguna variante.
productsRouter.get('/products', async (req, res) => {
  if (req.query.sync === '1') {
    try { await syncProducts(); } catch (e) { /* devolvemos lo que haya */ }
  }
  const docs = await Product.find().sort({ generatedCount: 1, title: 1 }).lean();
  const products = docs.map((p) => ({
    id: p.shopifyId,
    title: p.title,
    handle: p.handle,
    wash: p.wash,
    description: p.description,
    image: p.image,
    images: p.images,
    fitSpec: p.fitSpec || '',
    fitCut: p.fitCut || '',
    fitLength: p.fitLength || '',
    generatedCount: p.generatedCount,
    lastGeneratedAt: p.lastGeneratedAt,
    isNew: p.generatedCount === 0,
  }));
  res.json({ count: products.length, products });
});

// POST /api/products/:id/generate
// Receta: recipeAngles x hasta recipeRefs referencias activas (default 2x2=4).
// body opcional: { angles?: string[] } para override manual.
productsRouter.post('/products/:id/generate', async (req, res) => {
  const product = await Product.findOne({ shopifyId: Number(req.params.id) }).lean();
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (!product.image) return res.status(400).json({ error: 'El producto no tiene imagen' });

  const angles = Array.isArray(req.body?.angles) && req.body.angles.length
    ? req.body.angles
    : config.recipeAngles;

  // Receta REFERENCE-DRIVEN: 2 referencias por angulo, priorizando las que este
  // producto NO uso todavia (variedad real, no siempre la misma).
  const need = angles.length * 2;
  const picked = await pickRefs({ shopifyProductId: product.shopifyId, n: need });
  const jobs = [];
  let pi = 0;
  angles.forEach((angleId) => {
    for (let k = 0; k < 2; k++) {
      const ref = picked.length ? picked[pi++ % picked.length] : null;
      jobs.push({ angleId, ref, styleMode: 'organic' });
    }
  });

  const created = await enqueueJobs({
    imageUrl: product.image,
    jobs,
    productDescription: [product.title, product.description].filter(Boolean).join('. '),
    fitSpec: product.fitSpec || '',
    meta: {
      shopifyProductId: product.shopifyId,
      product: product.title,
      wash: product.wash,
      fitSpec: product.fitSpec || '',
      sourceBackUrl: product.images?.[1] || '',
    },
  });

  await Product.updateOne(
    { shopifyId: product.shopifyId },
    { $inc: { generatedCount: created.length }, $set: { lastGeneratedAt: new Date() } }
  );

  res.status(202).json({
    queued: created.map((d) => ({ id: d._id, angle: d.angle })),
    faithful: jobs.filter((j) => !j.ref).length,
    vibe: jobs.filter((j) => j.ref).length,
  });
});
