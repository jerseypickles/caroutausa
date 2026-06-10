import { Reference } from './models/reference.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Elige n referencias activas para un producto, PRIORIZANDO las que ese producto
// todavia NO uso (variedad real, no siempre la misma). Devuelve [{ id, b64 }].
export async function pickRefs({ shopifyProductId = null, n = 1 } = {}) {
  const refs = await Reference.find({ active: true }).select('+imageData').lean();
  if (!refs.length) return [];

  let usedIds = new Set();
  if (shopifyProductId != null) {
    const [cs, ks] = await Promise.all([
      Creative.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
      Carousel.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
    ]);
    usedIds = new Set([...cs, ...ks].map((d) => String(d.referenceId)));
  }

  const unused = shuffle(refs.filter((r) => !usedIds.has(String(r._id))));
  const used = shuffle(refs.filter((r) => usedIds.has(String(r._id))));
  const ordered = [...unused, ...used]; // primero las no usadas
  return ordered.slice(0, Math.min(n, ordered.length)).map((r) => ({ id: String(r._id), b64: r.imageData }));
}
