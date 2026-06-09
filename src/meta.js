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

// Creative de carrusel: cards = [{ imageHash, link, name }]
export function createCarouselCreative({ name, message, link, cards }) {
  return graph('POST', `${acct()}/adcreatives`, {
    name,
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
