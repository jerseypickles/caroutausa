import crypto from 'node:crypto';
import { config } from './config.js';

const M = config.meta;
const BASE = `https://graph.facebook.com/${M.graphVersion}`;

export function metaConfigured() {
  return Boolean(M.accessToken && M.adAccountId && M.pageId && M.pixelId);
}

// appsecret_proof: Meta lo recomienda para llamadas server-side.
function proof() {
  if (!M.appSecret) return null;
  return crypto.createHmac('sha256', M.appSecret).update(M.accessToken).digest('hex');
}

// Llamada generica a la Graph API. params: objetos anidados se mandan como JSON.
async function graph(method, path, params = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.append('access_token', M.accessToken);
  const p = proof();
  if (p) body.append('appsecret_proof', p);

  const url = `${BASE}/${path}`;
  const res = await fetch(url, method === 'GET'
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const getUrl = method === 'GET' ? `${url}?${body.toString()}` : null;
  const r = method === 'GET' ? await fetch(getUrl) : res;
  const json = await r.json();
  if (json.error) {
    const e = json.error;
    const detail = [e.message, e.error_user_title, e.error_user_msg].filter(Boolean).join(' · ');
    throw new Error(`Meta API: ${detail} (code ${e.code}/${e.error_subcode || 0})`);
  }
  return json;
}

const acct = () => M.adAccountId; // ya viene como act_...

// Advantage+ creative SELECTIVO: prendemos solo lo que NO toca la estetica (mejor CTA)
// y APAGAMOS explicitamente todo lo que altera la foto/copy (Meta los auto-aplica por
// defecto si no los desactivas). Asi protegemos el look organico de los fitpics.
function enhancements() {
  const off = { enroll_status: 'OPT_OUT' };
  const on = { enroll_status: 'OPT_IN' };
  return {
    degrees_of_freedom_spec: {
      creative_features_spec: {
        enhance_cta: on,                       // mejora el boton (no toca la imagen)
        image_touchups: off,                   // retoques de imagen -> NO
        image_brightness_and_contrast: off,    // brillo/contraste -> NO
        image_uncrop: off,                     // expansion/relleno de imagen -> NO
        image_templates: off,                  // plantillas con texto -> NO
        add_text_overlay: off,                 // texto encima de la foto -> NO
        text_improvements: off,                // reescribe el copy -> NO (usamos el nuestro)
        media_liquidity_animated_image: off,   // animar la foto -> NO
      },
    },
  };
}

// --- creacion ---
export function createCampaign({ name, objective = 'OUTCOME_SALES' }) {
  return graph('POST', `${acct()}/campaigns`, {
    name, objective, status: 'PAUSED', special_ad_categories: [],
    is_adset_budget_sharing_enabled: false, // ABO: budget por ad set, sin compartir
  });
}

export function createAdSet({ name, campaignId, dailyBudgetCents, optimizationEvent = 'ADD_TO_CART', countries = ['US'] }) {
  return graph('POST', `${acct()}/adsets`, {
    name,
    campaign_id: campaignId,
    daily_budget: dailyBudgetCents,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    promoted_object: { pixel_id: M.pixelId, custom_event_type: optimizationEvent },
    targeting: { geo_locations: { countries } }, // amplio, Meta encuentra el publico
    status: 'PAUSED',
  });
}

// Sube una imagen (base64) -> image_hash.
export async function uploadImage(b64) {
  const json = await graph('POST', `${acct()}/adimages`, { bytes: b64 });
  const imgs = json.images || {};
  const first = Object.values(imgs)[0];
  if (!first?.hash) throw new Error('Meta no devolvio image_hash');
  return first.hash;
}

// Creative de imagen sola.
export function createSingleImageCreative({ name, imageHash, link, message }) {
  return graph('POST', `${acct()}/adcreatives`, {
    name,
    object_story_spec: {
      page_id: M.pageId,
      link_data: {
        image_hash: imageHash,
        link,
        message: message || '',
        call_to_action: { type: 'SHOP_NOW', value: { link } },
      },
    },
  });
}

// Creative de imagen con CUSTOMIZACION POR PLACEMENT: usa el 9:16 (story) en
// Stories/Reels y el 1:1/4:5 (feed) en el resto. asset_feed_spec = Advantage+ creative.
export function createPlacementImageCreative({ name, storyHash, feedHash, link, messages = [], titles = [] }) {
  const bodies = (messages.length ? messages : ['']).slice(0, 5).map((t) => ({ text: t }));
  const titleSpec = titles.filter(Boolean).slice(0, 5).map((t) => ({ text: t }));
  return graph('POST', `${acct()}/adcreatives`, {
    name,
    ...enhancements(),
    object_story_spec: { page_id: M.pageId },
    asset_feed_spec: {
      images: [
        { hash: feedHash, adlabels: [{ name: 'feed_img' }] },
        { hash: storyHash, adlabels: [{ name: 'story_img' }] },
      ],
      bodies,
      ...(titleSpec.length ? { titles: titleSpec } : {}),
      link_urls: [{ website_url: link }],
      call_to_action_types: ['SHOP_NOW'],
      ad_formats: ['SINGLE_IMAGE'],
      asset_customization_rules: [
        {
          customization_spec: { publisher_platforms: ['instagram', 'facebook'], instagram_positions: ['story', 'reels'], facebook_positions: ['story', 'facebook_reels'] },
          image_label: { name: 'story_img' },
        },
        {
          // default para el resto de placements (feed, explore, etc.)
          customization_spec: { publisher_platforms: ['instagram', 'facebook'], instagram_positions: ['stream', 'explore'], facebook_positions: ['feed'] },
          image_label: { name: 'feed_img' },
        },
      ],
    },
  });
}

// Creative de carrusel: cards = [{ imageHash, link, name }]
export function createCarouselCreative({ name, message, link, cards }) {
  return graph('POST', `${acct()}/adcreatives`, {
    name,
    ...enhancements(),
    object_story_spec: {
      page_id: M.pageId,
      link_data: {
        message: message || '',
        link,
        child_attachments: cards.map((c) => ({
          image_hash: c.imageHash,
          link: c.link,
          name: c.name || '',
          call_to_action: { type: 'SHOP_NOW', value: { link: c.link } },
        })),
        multi_share_optimized: true,
      },
    },
  });
}

export function createAd({ name, adsetId, creativeId }) {
  return graph('POST', `${acct()}/ads`, {
    name, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED',
  });
}

// --- gestion ---
export function setStatus(objectId, status) {
  return graph('POST', objectId, { status }); // ACTIVE | PAUSED
}

export function deleteObject(objectId) {
  return graph('POST', objectId, { status: 'DELETED' });
}

// Insights por objeto (campaign/adset/ad).
export async function getInsights(objectId, datePreset = 'maximum') {
  const fields = 'impressions,clicks,ctr,cpc,spend,actions,cost_per_action_type';
  const json = await graph('GET', `${objectId}/insights`, { fields, date_preset: datePreset });
  return json.data?.[0] || null;
}

// Parsea actions de Meta a ATC / compras.
export function parseActions(row) {
  const out = { addToCart: 0, purchases: 0 };
  for (const a of row?.actions || []) {
    if (/add_to_cart/.test(a.action_type)) out.addToCart += Number(a.value) || 0;
    if (/purchase/.test(a.action_type)) out.purchases += Number(a.value) || 0;
  }
  return out;
}

function normInsights(row) {
  if (!row) return null;
  const acts = parseActions(row);
  return {
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.cpc) || 0,
    spend: Number(row.spend) || 0,
    addToCart: acts.addToCart,
    purchases: acts.purchases,
  };
}

// --- VISUALIZACION: lee las campañas que YA existen en la cuenta ---
export async function listAccountCampaigns() {
  const fields = 'name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,' +
    'insights.date_preset(maximum){impressions,clicks,ctr,cpc,spend,actions}';
  const json = await graph('GET', `${acct()}/campaigns`, { fields, limit: 50 });
  return (json.data || []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    effectiveStatus: c.effective_status,
    objective: c.objective,
    dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
    createdTime: c.created_time,
    insights: normInsights(c.insights?.data?.[0]),
  }));
}

// Ads de una campaña, con thumbnail del creative y metricas.
export async function getCampaignAds(campaignId) {
  const fields = 'name,effective_status,creative{thumbnail_url,image_url},' +
    'insights.date_preset(maximum){impressions,clicks,ctr,spend,actions}';
  const json = await graph('GET', `${campaignId}/ads`, { fields, limit: 50 });
  return (json.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    effectiveStatus: a.effective_status,
    thumbnail: a.creative?.image_url || a.creative?.thumbnail_url || null,
    insights: normInsights(a.insights?.data?.[0]),
  }));
}
