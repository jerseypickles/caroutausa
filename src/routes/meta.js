import { Router } from 'express';
import sharp from 'sharp';
import { Creative } from '../models/creative.js';
import { Carousel } from '../models/carousel.js';
import { VideoClip } from '../models/videoClip.js';
import { Reference } from '../models/reference.js';
import { Product } from '../models/product.js';
import { MetaCampaign } from '../models/metaCampaign.js';
import { config } from '../config.js';
import * as meta from '../meta.js';

export const metaRouter = Router();

// ADN extra del REF para el aprendizaje (familia/lane, sneakers, gráfico del top).
async function refTags(referenceId) {
  if (!referenceId) return {};
  const ref = await Reference.findById(referenceId).select('dna').lean().catch(() => null);
  const o = ref?.dna?.outfit || ref?.dna || {};
  return {
    refLane: o.family || null,
    sneakers: o.sneakers ? String(o.sneakers).slice(0, 40) : null,
    graphic: o.graphic ? String(o.graphic).slice(0, 40) : null,
  };
}

function productLink(handle) {
  return handle ? `${config.storeUrl}/products/${handle}` : config.storeUrl;
}

// Meta no acepta WebP -> convertimos a JPG. Devuelve base64 JPG.
async function toJpgB64(src) {
  if (!src) throw new Error('Creative sin imagen');
  const jpg = await sharp(Buffer.from(src, 'base64')).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  return jpg.toString('base64');
}
const storyB64 = (c) => toJpgB64(c.hookImageData || c.imageData);                              // 9:16 (hook si existe)
const feedB64 = (c) => toJpgB64(c.hookSquareImageData || c.squareImageData || c.feedImageData || c.imageData); // 1:1 (hook si existe)

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

// GET /api/meta/diagnose -> qué puede REALMENTE el token (scopes, cuenta, página)
metaRouter.get('/meta/diagnose', async (_req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  try { res.json(await meta.diagnose()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});


// GET /api/meta/raw-actions/:campaignId -> diagnostico: todos los action_types crudos
metaRouter.get('/meta/raw-actions/:campaignId', async (req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  try { res.json(await meta.rawActionsBreakdown(req.params.campaignId)); }
  catch (err) { res.status(502).json({ error: err.message }); }
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

// DELETE /api/meta/account-campaigns/:id -> borra una campaña de Meta (status DELETED)
metaRouter.delete('/meta/account-campaigns/:id', async (req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  try {
    await meta.deleteObject(req.params.id);
    await MetaCampaign.updateOne({ campaignId: req.params.id }, { $set: { status: 'DELETED' } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/meta/ig-accounts -> lista las cuentas de IG alcanzables (para encontrar el ID)
metaRouter.get('/meta/ig-accounts', async (_req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  try { res.json({ resolved: await meta.getIgActorId(), sources: await meta.listIgAccounts() }); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/meta/test-placement -> valida la creacion de un creative con customizacion
// por placement (story 9:16 + feed 1:1) SIN crear ad ni gastar. Devuelve ok o el error.
metaRouter.post('/meta/test-placement', async (_req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  let campaignId = null;
  try {
    const c = await Creative.findOne({ qcStatus: 'approved', genStatus: 'ready' })
      .select('+imageData +feedImageData +squareImageData +hookImageData +hookSquareImageData product shopifyProductId').lean();
    if (!c) return res.status(404).json({ error: 'No hay single aprobado para testear' });
    const prod = c.shopifyProductId ? await Product.findOne({ shopifyId: c.shopifyProductId }).lean() : null;
    const link = productLink(prod?.handle);
    const igActorId = await meta.getIgActorId();
    const storyHash = await meta.uploadImage(await storyB64(c));
    const feedHash = await meta.uploadImage(await feedB64(c));
    // Cadena COMPLETA (campaña+adset+creative+ad, PAUSED) para validar el error de IG a
    // nivel ad. Se borra al final (exito o error) -> no deja huerfanas ni gasta.
    const campaign = await meta.createCampaign({ name: 'TEST · borrable' });
    campaignId = campaign.id;
    const adSet = await meta.createAdSet({ name: 'TEST · adset', campaignId: campaign.id, dailyBudgetCents: 1000, optimizationEvent: 'PURCHASE' });
    const creative = await meta.createPlacementImageCreative({ name: 'TEST · placement', storyHash, feedHash, link, messages: ['test'], titles: ['test'], igActorId });
    const ad = await meta.createAd({ name: 'TEST · ad', adsetId: adSet.id, creativeId: creative.id });
    await meta.deleteObject(campaign.id);
    res.json({ ok: true, validated: 'campaña+adset+creative+ad', igActorId: igActorId || '(ninguna)', adId: ad.id });
  } catch (err) {
    if (campaignId) { try { await meta.deleteObject(campaignId); } catch { /* noop */ } }
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

// GET /api/meta/eligible -> singles Y carruseles aprobados, listos para anunciar
metaRouter.get('/meta/eligible', async (_req, res) => {
  const [singles, carousels, videos] = await Promise.all([
    Creative.find({ qcStatus: 'approved', genStatus: 'ready' }).sort({ updatedAt: -1 }).lean(),
    Carousel.find({ qcStatus: 'approved', genStatus: 'ready' }).sort({ updatedAt: -1 }).lean(),
    VideoClip.find({ qcStatus: 'approved', stage: 'ready', metaAdId: null }).sort({ updatedAt: -1 }).lean(),
  ]);
  const items = [
    ...singles.map((c) => ({ id: String(c._id), type: 'single', product: c.product, angle: c.angle })),
    ...carousels.map((c) => ({ id: String(c._id), type: 'carousel', product: c.product, cards: (c.cards || []).length })),
    ...videos.map((c) => ({ id: String(c._id), type: 'video', product: c.product, hookLine: c.hookLine })),
  ];
  res.json({ items, creatives: singles });
});

// POST /api/meta/launch
// body: { name?, dailyBudget?, optimizationEvent?, creativeIds?: [], carouselIds?: [] }
// Nombre AUTO si no viene; optimiza PURCHASE por defecto. Singles (con imagen por
// placement: 9:16 story / 1:1 feed) + carruseles, todos en UN mismo ad set. PAUSED.
metaRouter.post('/meta/launch', async (req, res) => {
  if (!meta.metaConfigured()) return res.status(400).json({ error: 'Meta no esta configurado' });
  const body = req.body || {};
  const creativeIds = Array.isArray(body.creativeIds) ? body.creativeIds : [];
  const carouselIds = Array.isArray(body.carouselIds) ? body.carouselIds : [];
  const videoIds = Array.isArray(body.videoIds) ? body.videoIds : [];
  if (!creativeIds.length && !carouselIds.length && !videoIds.length) return res.status(400).json({ error: 'Elegí al menos una pieza' });
  const budget = Number(body.dailyBudget) || 25;
  const optimizationEvent = body.optimizationEvent || 'PURCHASE';

  const singles = creativeIds.length
    ? await Creative.find({ _id: { $in: creativeIds }, genStatus: 'ready' }).select('+imageData +feedImageData +squareImageData +hookImageData +hookSquareImageData').lean() : [];
  const carousels = carouselIds.length
    ? await Carousel.find({ _id: { $in: carouselIds }, genStatus: 'ready' }).select('+cards.imageData').lean() : [];
  const videos = videoIds.length
    ? await VideoClip.find({ _id: { $in: videoIds }, stage: 'ready' }).select('shopifyProductId product hookLine wash castTag fontTag motionPreset copy referenceId').lean() : [];
  if (!singles.length && !carousels.length && !videos.length) return res.status(400).json({ error: 'Sin piezas validas' });

  // Nombre auto: CAROTA · <wash/o N washes> · YYYY-MM-DD · NS+MC
  const date = new Date().toISOString().slice(0, 10);
  const prods = [...new Set([...singles, ...carousels, ...videos].map((x) => (x.product || '').replace(' Denim Short', '')))].filter(Boolean);
  const prodPart = prods.length === 1 ? prods[0] : `${prods.length} washes`;
  const vp = videos.length ? `+${videos.length}V` : '';
  const name = (body.name && body.name.trim()) || `CAROTA · ${prodPart} · ${date} · ${singles.length}S+${carousels.length}C${vp}`;

  try {
    const campaign = await meta.createCampaign({ name });
    const adSet = await meta.createAdSet({
      name: `${name} · adset`,
      campaignId: campaign.id,
      dailyBudgetCents: Math.round(budget * 100),
      optimizationEvent,
    });

    const ads = [];
    // Cuenta de Instagram (requerida porque vamos a placements de IG).
    const igActorId = await meta.getIgActorId();
    // Agrega la promo activa (SUMMER25, etc.) al final de cada copy.
    const withPromo = (msg) => (config.metaPromo ? `${msg}\n\n${config.metaPromo}` : msg);
    // Singles -> customizacion por placement: story 9:16 en Stories/Reels, feed 1:1 en el resto.
    for (const c of singles) {
      const prod = c.shopifyProductId ? await Product.findOne({ shopifyId: c.shopifyProductId }).lean() : null;
      const link = productLink(prod?.handle);
      const storyHash = await meta.uploadImage(await storyB64(c));
      const feedHash = await meta.uploadImage(await feedB64(c));
      // Customizacion por placement = 1 body + 1 title (Meta no permite multi-body con
      // reglas de placement). Usamos el mejor primary text + headline. Las 5 quedan en QC.
      const message = withPromo(c.copy?.primaryTexts?.[0] || c.copy?.primaryText || `${c.product || 'CAROTA'} — shop now`);
      const titles = c.copy?.headlines?.[0] ? [c.copy.headlines[0]] : (c.copy?.headline ? [c.copy.headline] : []);
      const creative = await meta.createPlacementImageCreative({
        name: `${c.product || 'CAROTA'} · ${c.angle}`, storyHash, feedHash, link, messages: [message], titles, igActorId,
      });
      const ad = await meta.createAd({ name: `${c.product} · ${c.angle}`, adsetId: adSet.id, creativeId: creative.id });
      ads.push({ adId: ad.id, metaCreativeId: creative.id, creativeId: c._id, product: c.product, link, format: 'single',
        adn: { castTag: c.castTag, sceneTag: c.sceneTag, angle: c.angle, wash: c.wash, fontTag: c.fontTag, ...(await refTags(c.referenceId)) } });
    }
    // Carruseles -> sube cada card (JPG) y crea el creative de carrusel
    for (const cr of carousels) {
      const prod = cr.shopifyProductId ? await Product.findOne({ shopifyId: cr.shopifyProductId }).lean() : null;
      const link = productLink(prod?.handle);
      const cards = [];
      for (const card of (cr.cards || [])) {
        if (!card.imageData) continue;
        const hash = await meta.uploadImage(await toJpgB64(card.imageData));
        cards.push({ imageHash: hash, link, name: (cr.product || '').replace(' Denim Short', '') });
      }
      if (cards.length < 2) continue; // un carrusel necesita 2+ cards
      const creative = await meta.createCarouselCreative({
        name: `${cr.product || 'CAROTA'} · carrusel`,
        message: withPromo(cr.copy?.primaryTexts?.[0] || cr.copy?.primaryText || `${cr.product || 'CAROTA'} — shop now`), link, cards, igActorId,
      });
      const ad = await meta.createAd({ name: `${cr.product} · carrusel`, adsetId: adSet.id, creativeId: creative.id });
      ads.push({ adId: ad.id, metaCreativeId: creative.id, creativeId: cr._id, product: cr.product, link, format: 'carousel',
        adn: { castTag: cr.castTag, sceneTag: cr.sceneTag, angle: 'carrusel', wash: cr.wash, fontTag: cr.fontTag, ...(await refTags(cr.referenceId)) } });
    }

    // Videos -> sube cada mp4 (por URL) en PARALELO, espera que Meta los procese, crea el video
    // ad en el MISMO adset (varios videos = A/B en un adset). El short ya está fiel + hookeado.
    if (videos.length) {
      const base = config.publicBaseUrl.replace(/\/$/, '');
      const ups = await Promise.all(videos.map(async (v) => {
        const prod = v.shopifyProductId ? await Product.findOne({ shopifyId: v.shopifyProductId }).lean() : null;
        const link = productLink(prod?.handle);
        const videoId = await meta.uploadVideo({ fileUrl: `${base}/api/video/${v._id}/video` });
        return { v, link, videoId };
      }));
      const pending = new Set(ups.map((u) => u.videoId));
      for (let i = 0; i < 30 && pending.size; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        await Promise.all([...pending].map(async (vid) => {
          const s = await meta.getVideoStatus(vid).catch(() => 'processing');
          if (s === 'ready' || s === 'error') pending.delete(vid);
        }));
      }
      for (const u of ups) {
        const s = await meta.getVideoStatus(u.videoId).catch(() => 'processing');
        if (s !== 'ready') continue; // saltear los que Meta no procesó a tiempo
        const creative = await meta.createVideoCreative({
          name: `${u.v.product || 'CAROTA'} · video`, videoId: u.videoId,
          thumbUrl: `${base}/api/video/${u.v._id}/start-frame`, link: u.link,
          message: withPromo(u.v.copy?.primaryTexts?.[0] || u.v.copy?.primaryText || u.v.hookLine || `${u.v.product || 'CAROTA'} — shop now`),
          title: u.v.copy?.headlines?.[0] || u.v.copy?.headline || '',
          igActorId,
        });
        const ad = await meta.createAd({ name: `${u.v.product} · video`, adsetId: adSet.id, creativeId: creative.id });
        ads.push({ adId: ad.id, metaCreativeId: creative.id, creativeId: u.v._id, product: u.v.product, link: u.link, format: 'video',
          adn: { castTag: u.v.castTag || 'lower-body', sceneTag: 'fit-check', angle: 'video', wash: u.v.wash, fontTag: u.v.fontTag, motionPreset: u.v.motionPreset, ...(await refTags(u.v.referenceId)) } });
        await VideoClip.findByIdAndUpdate(u.v._id, { metaAdId: ad.id, metaCampaignId: campaign.id });
      }
    }

    const doc = await MetaCampaign.create({
      name, campaignId: campaign.id, adSetId: adSet.id,
      optimizationEvent, dailyBudget: budget, status: 'PAUSED', ads,
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
  // Insights EN VIVO (dedup + atribución por click), no el snapshot guardado.
  if (meta.metaConfigured()) {
    await Promise.all(campaigns.map(async (c) => {
      const live = await meta.getCampaignInsights(c.campaignId);
      if (live) c.insights = live;
    }));
  }
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
    // Los 3 niveles: tambien cada AD (si no, la campaña queda ACTIVE pero no entrega).
    let ads = 0;
    for (const a of (doc.ads || [])) {
      if (!a.adId) continue;
      try { await meta.setStatus(a.adId, status); ads++; } catch (e) { console.error('[meta] setStatus ad:', e.message); }
    }
    doc.status = status;
    await doc.save();
    res.json({ status, ads });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/meta/campaigns/:id/ads -> ad set + cada creativo con metricas de Meta
metaRouter.get('/meta/campaigns/:id/ads', async (req, res) => {
  const doc = await MetaCampaign.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'No encontrada' });
  try {
    const ads = await meta.getCampaignAds(doc.campaignId);
    const byAd = Object.fromEntries((doc.ads || []).map((a) => [a.adId, a]));
    const out = ads.map((a) => {
      const ours = byAd[a.id] || null;
      const i = a.insights || {};
      const cpa = i.purchases > 0 ? i.spend / i.purchases : null;
      const cpatc = i.addToCart > 0 ? i.spend / i.addToCart : null;
      return {
        adId: a.id, name: a.name, status: a.effectiveStatus,
        format: ours?.format || 'single',
        // imagen propia (linda y consistente) si la tenemos; si no, thumb de Meta
        image: ours?.creativeId
          ? (ours.format === 'carousel' ? `/api/carousels/${ours.creativeId}/cards/0/image`
            : ours.format === 'video' ? `/api/video/${ours.creativeId}/start-frame`
            : `/api/creatives/${ours.creativeId}/image?p=square`)
          : a.thumbnail,
        product: ours?.product || '',
        insights: { ...i, cpa, cpatc },
      };
    });
    res.json({ adSetId: doc.adSetId, adSetName: `${doc.name} · adset`, optimizationEvent: doc.optimizationEvent, dailyBudget: doc.dailyBudget, status: doc.status, ads: out });
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
