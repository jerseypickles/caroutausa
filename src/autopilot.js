import { Product } from './models/product.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import { pickRefs } from './refs.js';
import { enqueueJobs, enqueueFlatlay } from './generation.js';
import { generateCarouselInBackground } from './carousel.js';
import { logActivity } from './models/activity.js';
import { config } from './config.js';

// Motor inteligente: cada tick elige UN producto con trabajo pendiente y genera UNA
// pieza (para no saturar la RAM del plan starter). Prioriza productos nuevos/menos
// trabajados. Decide la pieza: si no tiene packshot -> flat-lay; si no -> singles
// con referencia. Cuando todos llegan al target, queda al dia (idle).
let running = false;

export async function runAutopilot({ manual = false } = {}) {
  if (!config.autopilotEnabled && !manual) return null;
  if (running) return null; // no solapar ticks
  running = true;
  try {
    const products = await Product.find({ image: { $ne: null } })
      .sort({ generatedCount: 1, lastGeneratedAt: 1 })
      .lean();

    for (const p of products) {
      if ((p.generatedCount || 0) >= config.autopilotTarget) continue;
      // no pisar un producto que ya esta generando
      const inflight = await Creative.countDocuments({ shopifyProductId: p.shopifyId, genStatus: 'generating' });
      if (inflight) continue;

      const productDescription = [p.title, p.description].filter(Boolean).join('. ');
      const fitSpec = p.fitSpec || '';
      const meta = { shopifyProductId: p.shopifyId, product: p.title, wash: p.wash, fitSpec };

      // 1) ¿ya tiene packshot? si no, ese es el siguiente paso (rapido, 1 imagen).
      const hasFlatlay = await Creative.countDocuments({ shopifyProductId: p.shopifyId, format: 'flatlay' });
      if (!hasFlatlay) {
        const doc = await enqueueFlatlay({ imageUrl: p.image, productDescription, fitSpec, meta });
        await logActivity('flatlay', `Auto: generando packshot de ${p.title}`, { product: p.title, refId: String(doc._id), level: 'ok' });
        return { product: p.title, piece: 'flatlay' };
      }

      // 2) ¿ya tiene carrusel? si no, generar uno (cohesivo, con referencia NUEVA).
      const hasCarousel = await Carousel.countDocuments({ shopifyProductId: p.shopifyId });
      if (!hasCarousel) {
        const [ref] = await pickRefs({ shopifyProductId: p.shopifyId, wash: p.wash, n: 1 });
        const cdoc = await Carousel.create({
          shopifyProductId: p.shopifyId, product: p.title, wash: p.wash, sourceImageUrl: p.image,
          hasReference: Boolean(ref), referenceId: ref?.id || null, referenceDna: ref?.dna || '', referenceImageData: ref?.b64 || null, genStatus: 'generating',
        });
        generateCarouselInBackground(cdoc._id).catch((e) => console.error('[autopilot] carousel:', e.message));
        await Product.updateOne({ shopifyId: p.shopifyId }, { $inc: { generatedCount: 3 }, $set: { lastGeneratedAt: new Date() } });
        await logActivity('carousel', `Auto: generando carrusel de ${p.title}`, { product: p.title, refId: String(cdoc._id), level: 'ok' });
        return { product: p.title, piece: 'carousel' };
      }

      // 3) si no, una tanda de singles con referencias NUEVAS (no usadas por el producto).
      const angle = (p.generatedCount || 0) % 2 === 0 ? 'realista' : 'gancho_click';
      const picked = await pickRefs({ shopifyProductId: p.shopifyId, wash: p.wash, n: 2 });
      const jobs = picked.length
        ? picked.map((ref) => ({ angleId: angle, ref, styleMode: 'organic' }))
        : [{ angleId: angle, ref: null, styleMode: 'organic' }];
      await enqueueJobs({ imageUrl: p.image, jobs, meta, productDescription, fitSpec });
      await Product.updateOne({ shopifyId: p.shopifyId }, { $inc: { generatedCount: jobs.length }, $set: { lastGeneratedAt: new Date() } });
      await logActivity('single', `Auto: ${jobs.length} singles (${angle}) de ${p.title}`, { product: p.title, level: 'ok' });
      return { product: p.title, piece: 'singles', count: jobs.length };
    }

    if (manual) await logActivity('autopilot', 'Autopilot: todos los productos al día', { level: 'info' });
    return null;
  } catch (err) {
    await logActivity('error', `Autopilot error: ${err.message}`, { level: 'error' });
    return null;
  } finally {
    running = false;
  }
}

export function startAutopilotCron() {
  if (!config.autopilotEnabled) {
    console.log('[autopilot] desactivado (AUTOPILOT_ENABLED=false)');
    return;
  }
  const ms = config.autopilotIntervalMin * 60 * 1000;
  setInterval(() => { runAutopilot().catch((e) => console.error('[autopilot] tick fallo:', e.message)); }, ms);
  console.log(`[autopilot] activo cada ${config.autopilotIntervalMin} min (target ${config.autopilotTarget}/producto)`);
}
