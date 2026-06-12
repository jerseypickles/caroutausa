import { MetaCampaign } from './models/metaCampaign.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import { VideoClip } from './models/videoClip.js';
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
      if (!ours) continue; // no es un ad nuestro
      const i = ad.insights || {};
      const m = {
        impressions: i.impressions || 0, clicks: i.clicks || 0, ctr: i.ctr || 0, spend: i.spend || 0,
        addToCart: i.addToCart || 0, purchases: i.purchases || 0,
        cpa: i.purchases > 0 ? +(i.spend / i.purchases).toFixed(2) : null, updatedAt: new Date(),
      };
      // DURABLE: métricas en el ad de la campaña (la fuente del aprendizaje — sobrevive aunque
      // se borre el creativo, porque el ADN quedó snapshotteado al lanzar).
      await MetaCampaign.updateOne({ campaignId: c.campaignId, 'ads.adId': ad.id }, { $set: { 'ads.$.metrics': m } });
      // también al creativo (para mostrar en QC) si todavía existe.
      if (ours.creativeId) {
        const Model = ours.format === 'carousel' ? Carousel : (ours.format === 'video' ? VideoClip : Creative);
        await Model.findByIdAndUpdate(ours.creativeId, { metrics: m }).catch(() => {});
      }
      updated++;
    }
  }
  return { updated, campaigns: camps.length };
}

// APRENDIZAJE: agrupa los creativos QUE YA CORRIERON por cada dimensión de su ADN
// (escena, casting, ángulo, wash, formato) y calcula el CTR/CPA promedio ponderado ->
// leaderboard de qué atributo gana.
const DIMS = ['format', 'sceneTag', 'castTag', 'angle', 'wash', 'refLane', 'sneakers', 'graphic', 'fontTag', 'motionPreset'];
// Umbral mínimo de impresiones para que un valor sea "confiable" (no coronar ruido).
// 80 es un piso bajo para filtrar samples de 3-20 impr; lo ideal son cientos/miles.
const MIN_IMPR = 80;
export async function learningReport() {
  // El aprendizaje sale de los ADS de las campañas (ADN snapshotteado + métricas), NO de los
  // creativos (que se pueden borrar). Así sobrevive aunque borres la pieza original.
  const camps = await MetaCampaign.find({ status: { $ne: 'DELETED' } }).select('ads').lean();
  const items = [];
  for (const c of camps) {
    for (const a of (c.ads || [])) {
      const m = a.metrics;
      if (!m || !(m.impressions > 0)) continue;
      const adn = a.adn || {};
      const washFromProduct = (a.product || '').match(/^(\w+)\s+wash/i)?.[1]?.toLowerCase() || null;
      items.push({
        format: a.format || 'single',
        angle: adn.angle || (a.format === 'carousel' ? 'carrusel' : (a.format === 'video' ? 'video' : null)),
        castTag: adn.castTag, sceneTag: adn.sceneTag,
        wash: adn.wash || washFromProduct,
        refLane: adn.refLane, sneakers: adn.sneakers, graphic: adn.graphic,
        fontTag: adn.fontTag, motionPreset: adn.motionPreset,
        metrics: m,
      });
    }
  }
  const report = groupByDims(items, DIMS);
  // POR PRODUCTO: qué ADN rinde para CADA wash (no solo global).
  const washes = [...new Set(items.map((i) => i.wash).filter(Boolean))];
  const byWash = {};
  for (const w of washes) {
    byWash[w] = groupByDims(items.filter((i) => i.wash === w), DIMS.filter((d) => d !== 'wash' && d !== 'format'));
  }
  return { totalCreatives: items.length, minImpr: MIN_IMPR, report, washes, byWash };
}

// Agrupa items por cada dimensión -> CTR/CPA por valor (corona el ganador confiable).
function groupByDims(items, dims) {
  const report = {};
  for (const dim of dims) {
    const groups = {};
    for (const it of items) {
      const v = it[dim]; if (!v) continue;
      const g = groups[v] || (groups[v] = { value: v, n: 0, impressions: 0, clicks: 0, spend: 0, purchases: 0 });
      const m = it.metrics || {};
      g.n++; g.impressions += m.impressions || 0; g.clicks += m.clicks || 0; g.spend += m.spend || 0; g.purchases += m.purchases || 0;
    }
    const rows = Object.values(groups).map((g) => ({
      value: g.value, n: g.n, impressions: g.impressions, spend: +g.spend.toFixed(0), purchases: g.purchases,
      ctr: g.impressions ? +(g.clicks / g.impressions * 100).toFixed(2) : 0,
      cpa: g.purchases ? +(g.spend / g.purchases).toFixed(2) : null,
      low: g.impressions < MIN_IMPR,
    })).sort((a, b) => (a.low - b.low) || (b.ctr - a.ctr));
    if (rows.length) report[dim] = rows;
  }
  return report;
}

// CIERRA EL LOOP: el preset de movimiento con mejor CTR (con data suficiente). null si no hay
// data -> la generación cae al round-robin. Lo usa el autopilot de video para sesgar al ganador.
export async function bestMotionPreset() {
  const camps = await MetaCampaign.find({ status: { $ne: 'DELETED' } }).select('ads').lean();
  const g = {};
  for (const c of camps) {
    for (const a of (c.ads || [])) {
      if (a.format !== 'video' || !a.adn?.motionPreset || !a.metrics) continue;
      const x = g[a.adn.motionPreset] || (g[a.adn.motionPreset] = { impr: 0, clicks: 0 });
      x.impr += a.metrics.impressions || 0; x.clicks += a.metrics.clicks || 0;
    }
  }
  const ranked = Object.entries(g)
    .map(([k, x]) => ({ k, ctr: x.impr ? x.clicks / x.impr : 0, impr: x.impr }))
    .filter((x) => x.impr >= MIN_IMPR)
    .sort((a, b) => b.ctr - a.ctr);
  return ranked.length ? ranked[0].k : null;
}
