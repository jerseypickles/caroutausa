import { Router } from 'express';
import { Product } from '../models/product.js';
import { Reference } from '../models/reference.js';
import { syncProducts } from '../sync.js';
import { enqueueJobs } from '../generation.js';
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

  const activeRefs = await Reference.find({ active: true }).select('+imageData').lean();
  // Barajar (Fisher-Yates) para variar las referencias entre generaciones y usar
  // todo el pool, no siempre las mismas. La variedad depende de cuantas haya activas.
  for (let k = activeRefs.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [activeRefs[k], activeRefs[j]] = [activeRefs[j], activeRefs[k]];
  }

  // Receta REFERENCE-DRIVEN (look iPhone apagado): cada variante usa una REFERENCIA
  // (el outfit lo manda la referencia; el director solo dirige la escena). Por angulo,
  // 2 referencias distintas del pool. Sin referencias activas -> cae a director-styled.
  const jobs = [];
  angles.forEach((angleId, i) => {
    if (activeRefs.length) {
      const n = Math.min(2, activeRefs.length);
      for (let k = 0; k < n; k++) {
        const r = activeRefs[(i * 2 + k) % activeRefs.length];
        jobs.push({ angleId, ref: { b64: r.imageData }, styleMode: 'organic' });
      }
    } else {
      jobs.push({ angleId, ref: null, styleMode: 'organic' });
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
