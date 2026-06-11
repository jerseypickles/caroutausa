import { MetaCampaign } from './models/metaCampaign.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import * as meta from './meta.js';

// Cron en proceso: sincroniza las métricas de Meta cada N min (default 12) para que el
// tab Aprendizaje esté siempre fresco SOLO, sin que el usuario apriete "sincronizar".
let _metricsTimer = null;
export function startMetricsCron() {
  if (_metricsTimer || !meta.metaConfigured()) return;
  const everyMin = Number(process.env.METRICS_SYNC_MIN || 12);
  const run = () => syncCreativeMetrics()
    .then((r) => { if (r.updated) console.log(`[metrics] sync auto: ${r.updated} creativos de ${r.campaigns} campañas`); })
    .catch((e) => console.error('[metrics] sync auto fallo:', e.message));
  run(); // al arranque
  _metricsTimer = setInterval(run, everyMin * 60 * 1000);
  console.log(`[metrics] cron auto cada ${everyMin}min`);
}

// WRITE-BACK: trae las métricas reales por ad de Meta y las pega al creativo/carrusel
// (matcheando adId -> creativeId). Así cada creativo queda con su CTR/gasto/compras real.
export async function syncCreativeMetrics() {
  if (!meta.metaConfigured()) return { updated: 0, campaigns: 0 };
  const camps = await MetaCampaign.find({ status: { $ne: 'DELETED' } }).lean();
  let updated = 0;
  for (const c of camps) {
    let ads;
    try { ads = await meta.getCampaignAds(c.campaignId); } catch (e) { continue; }
    const byAd = Object.fromEntries((c.ads || []).map((a) => [a.adId, a]));
    for (const ad of ads) {
      const ours = byAd[ad.id];
      if (!ours?.creativeId) continue;
      const i = ad.insights || {};
      const m = {
        impressions: i.impressions || 0, clicks: i.clicks || 0, ctr: i.ctr || 0, spend: i.spend || 0,
        addToCart: i.addToCart || 0, purchases: i.purchases || 0,
        cpa: i.purchases > 0 ? +(i.spend / i.purchases).toFixed(2) : null, updatedAt: new Date(),
      };
      const Model = ours.format === 'carousel' ? Carousel : Creative;
      await Model.findByIdAndUpdate(ours.creativeId, { metrics: m });
      updated++;
    }
  }
  return { updated, campaigns: camps.length };
}

// APRENDIZAJE: agrupa los creativos QUE YA CORRIERON por cada dimensión de su ADN
// (escena, casting, ángulo, wash, formato) y calcula el CTR/CPA promedio ponderado ->
// leaderboard de qué atributo gana.
const DIMS = ['sceneTag', 'castTag', 'angle', 'wash', 'format', 'fontTag'];
// Umbral mínimo de impresiones para que un valor sea "confiable" (no coronar ruido).
// 80 es un piso bajo para filtrar samples de 3-20 impr; lo ideal son cientos/miles.
const MIN_IMPR = 80;
export async function learningReport() {
  const [cs, ks] = await Promise.all([
    Creative.find({ 'metrics.impressions': { $gt: 0 } }).select('sceneTag castTag angle wash format fontTag metrics').lean(),
    Carousel.find({ 'metrics.impressions': { $gt: 0 } }).select('sceneTag castTag wash fontTag metrics').lean(),
  ]);
  const items = [
    ...cs.map((c) => ({ ...c, format: c.format || 'single' })),
    ...ks.map((c) => ({ ...c, angle: 'carrusel', format: 'carousel' })),
  ];
  const report = {};
  for (const dim of DIMS) {
    const groups = {};
    for (const it of items) {
      const v = it[dim]; if (!v) continue;
      const g = groups[v] || (groups[v] = { value: v, n: 0, impressions: 0, clicks: 0, spend: 0, purchases: 0 });
      const m = it.metrics || {};
      g.n++; g.impressions += m.impressions || 0; g.clicks += m.clicks || 0; g.spend += m.spend || 0; g.purchases += m.purchases || 0;
    }
    report[dim] = Object.values(groups).map((g) => ({
      value: g.value, n: g.n, impressions: g.impressions, spend: +g.spend.toFixed(0), purchases: g.purchases,
      ctr: g.impressions ? +(g.clicks / g.impressions * 100).toFixed(2) : 0,
      cpa: g.purchases ? +(g.spend / g.purchases).toFixed(2) : null,
      low: g.impressions < MIN_IMPR, // poca data: no es confiable todavía, no coronar
    })).sort((a, b) => (a.low - b.low) || (b.ctr - a.ctr)); // primero los confiables, luego por CTR
  }
  return { totalCreatives: items.length, minImpr: MIN_IMPR, report };
}
