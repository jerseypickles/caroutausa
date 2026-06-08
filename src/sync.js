import { fetchProducts } from './products.js';
import { Product } from './models/product.js';
import { config } from './config.js';

// Lee el catalogo de Shopify y hace upsert en Mongo. Los nuevos entran con
// generatedCount=0 (=> badge "nuevo" en el panel). No genera nada (accion = listar).
export async function syncProducts() {
  const products = await fetchProducts({ force: true });
  let added = 0;
  for (const p of products) {
    const res = await Product.updateOne(
      { shopifyId: p.id },
      {
        $setOnInsert: { firstSeenAt: new Date(), generatedCount: 0, lastGeneratedAt: null },
        $set: { title: p.title, handle: p.handle, wash: p.wash, description: p.description, image: p.image, images: p.images },
      },
      { upsert: true }
    );
    if (res.upsertedCount) added++;
  }
  if (added) console.log(`[sync] ${added} producto(s) nuevo(s) detectado(s)`);
  return { total: products.length, added };
}

// Corre al arranque y cada N minutos.
export function startProductCron() {
  syncProducts().catch((e) => console.error('[sync] fallo inicial:', e.message));
  const ms = config.syncIntervalMin * 60 * 1000;
  setInterval(() => {
    syncProducts().catch((e) => console.error('[sync] fallo:', e.message));
  }, ms);
  console.log(`[sync] cron cada ${config.syncIntervalMin} min`);
}
