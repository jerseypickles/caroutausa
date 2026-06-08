import { Router } from 'express';
import { Product } from '../models/product.js';
import { Reference } from '../models/reference.js';
import { syncProducts } from '../sync.js';
import { enqueueGeneration } from '../generation.js';
import { config } from '../config.js';

export const productsRouter = Router();

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
    image: p.image,
    images: p.images,
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

  const activeRefs = await Reference.find({ active: true })
    .sort({ createdAt: -1 })
    .limit(config.recipeRefs)
    .select('+imageData')
    .lean();
  const references = activeRefs.map((r) => ({ b64: r.imageData }));

  const created = await enqueueGeneration({
    imageUrl: product.image,
    angles,
    references,
    meta: {
      shopifyProductId: product.shopifyId,
      product: product.title,
      wash: product.wash,
    },
  });

  await Product.updateOne(
    { shopifyId: product.shopifyId },
    { $inc: { generatedCount: created.length }, $set: { lastGeneratedAt: new Date() } }
  );

  res.status(202).json({
    queued: created.map((d) => ({ id: d._id, angle: d.angle })),
    angles,
    referencesUsed: references.length,
  });
});
