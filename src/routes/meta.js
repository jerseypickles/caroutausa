import { Router } from 'express';
import { Creative } from '../models/creative.js';
import { Product } from '../models/product.js';
import { MetaCampaign } from '../models/metaCampaign.js';
import { config } from '../config.js';
import * as meta from '../meta.js';

export const metaRouter = Router();

function productLink(handle) {
  return handle ? `${config.storeUrl}/products/${handle}` : config.storeUrl;
}

// Parsea las actions de insights de Meta a numeros utiles.
function parseActions(row) {
  const out = { addToCart: 0, purchases: 0 };
  for (const a of row?.actions || []) {
    if (/add_to_cart/.test(a.action_type)) out.addToCart += Number(a.value) || 0;
    if (/purchase/.test(a.action_type)) out.purchases += Number(a.value) || 0;
  }
  return out;
}

// GET /api/meta/status -> esta configurado Meta?
metaRouter.get('/meta/status', (_req, res) => {
  res.json({ configured: meta.metaConfigured(), adAccountId: config.meta.adAccountId });
});

// GET /api/meta/account-campaigns -> campañas que YA existen en la cuenta (en vivo)
metaRouter.get('/meta/account-campaigns', async (_req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  try {
    const campaigns = await meta.listAccountCampaigns();
    res.json({ campaigns });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/meta/account-campaigns/:id/ads -> ads de una campaña (thumbnails + metricas)
metaRouter.get('/meta/account-campaigns/:id/ads', async (req, res) => {
  try {
    const ads = await meta.getCampaignAds(req.params.id);
    res.json({ ads });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/meta/eligible -> creatives aprobados listos para anunciar
metaRouter.get('/meta/eligible', async (_req, res) => {
  const creatives = await Creative.find({ qcStatus: 'approved', genStatus: 'ready' })
    .sort({ updatedAt: -1 }).lean();
  res.json({ creatives });
});

// POST /api/meta/launch
// body: { name, dailyBudget, optimizationEvent?, creativeIds: [] }
// Crea campaña + ad set + 1 ad por creative (imagen sola), todo PAUSED.
metaRouter.post('/meta/launch', async (req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  const { name, dailyBudget, optimizationEvent, creativeIds } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Falta name' });
  if (!Array.isArray(creativeIds) || !creativeIds.length) return res.status(400).json({ error: 'Elegí al menos un creative' });
  const budget = Number(dailyBudget) || 25;

  const creatives = await Creative.find({ _id: { $in: creativeIds }, genStatus: 'ready' }).select('+imageData').lean();
  if (!creatives.length) return res.status(400).json({ error: 'Sin creatives validos' });

  try {
    const campaign = await meta.createCampaign({ name });
    const adSet = await meta.createAdSet({
      name: `${name} · adset`,
      campaignId: campaign.id,
      dailyBudgetCents: Math.round(budget * 100),
      optimizationEvent: optimizationEvent || 'ADD_TO_CART',
    });

    const ads = [];
    for (const c of creatives) {
      const prod = c.shopifyProductId ? await Product.findOne({ shopifyId: c.shopifyProductId }).lean() : null;
      const link = productLink(prod?.handle);
      const hash = await meta.uploadImage(c.imageData);
      const creative = await meta.createSingleImageCreative({
        name: `${c.product || 'CAROTA'} · ${c.angle}`,
        imageHash: hash, link, message: `${c.product || 'CAROTA'} — shop now`,
      });
      const ad = await meta.createAd({ name: `${c.product} · ${c.angle}`, adsetId: adSet.id, creativeId: creative.id });
      ads.push({ adId: ad.id, metaCreativeId: creative.id, creativeId: c._id, product: c.product, link, format: 'single' });
    }

    const doc = await MetaCampaign.create({
      name, campaignId: campaign.id, adSetId: adSet.id,
      optimizationEvent: optimizationEvent || 'ADD_TO_CART',
      dailyBudget: budget, status: 'PAUSED', ads,
    });
    res.status(201).json({ campaign: doc });
  } catch (err) {
    console.error('[meta/launch]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/meta/campaigns -> campañas lanzadas (de Mongo)
metaRouter.get('/meta/campaigns', async (_req, res) => {
  const campaigns = await MetaCampaign.find({ status: { $ne: 'DELETED' } }).sort({ createdAt: -1 }).lean();
  res.json({ campaigns });
});

// POST /api/meta/campaigns/:id/status  body: { status: ACTIVE|PAUSED }
metaRouter.post('/meta/campaigns/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['ACTIVE', 'PAUSED'].includes(status)) return res.status(400).json({ error: 'status invalido' });
  const doc = await MetaCampaign.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  try {
    await meta.setStatus(doc.campaignId, status);
    await meta.setStatus(doc.adSetId, status);
    doc.status = status;
    await doc.save();
    res.json({ status });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/meta/campaigns/:id/insights -> refresca metricas
metaRouter.get('/meta/campaigns/:id/insights', async (req, res) => {
  const doc = await MetaCampaign.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  try {
    const row = await meta.getInsights(doc.campaignId);
    const acts = parseActions(row);
    doc.insights = {
      impressions: Number(row?.impressions) || 0,
      clicks: Number(row?.clicks) || 0,
      ctr: Number(row?.ctr) || 0,
      cpc: Number(row?.cpc) || 0,
      spend: Number(row?.spend) || 0,
      addToCart: acts.addToCart,
      purchases: acts.purchases,
      updatedAt: new Date(),
    };
    await doc.save();
    res.json({ insights: doc.insights });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
