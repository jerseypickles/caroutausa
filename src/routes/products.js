import { Router } from 'express';
import { fetchProducts } from '../products.js';

export const productsRouter = Router();

// GET /api/products  -> catalogo completo del Shopify (cacheado).
// ?force=1 para saltar el cache.
productsRouter.get('/products', async (req, res) => {
  try {
    const products = await fetchProducts({ force: req.query.force === '1' });
    res.json({ count: products.length, products });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
