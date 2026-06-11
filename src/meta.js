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
// token: por defecto el user token; se puede pasar un Page Access Token.
async function graph(method, path, params = {}, token = M.accessToken) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.append('access_token', token);
  // appsecret_proof solo aplica al user token (se genera con el access token del app).
  const p = token === M.accessToken ? proof() : null;
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

// Cuenta de Instagram para los ads (requerida en placements de IG). Prueba: override por
// env -> cuenta business de la pagina -> instagram_accounts del ad account -> page-backed.
// Se cachea a nivel modulo.
// Page Access Token (para leer/crear la cuenta de IG de la pagina).
async function pageToken() {
  try { const j = await graph('GET', M.pageId, { fields: 'access_token' }); return j.access_token || ''; } catch { return ''; }
}

let _igActorId;
export async function getIgActorId() {
  if (_igActorId !== undefined) return _igActorId;
  if (M.igAccountId) { _igActorId = M.igAccountId; return _igActorId; }
  _igActorId = '';
  const grab = (obj) => obj?.instagram_business_account?.id || obj?.connected_instagram_account?.id || '';
  try { _igActorId = grab(await graph('GET', M.pageId, { fields: 'instagram_business_account{id},connected_instagram_account{id}' })); } catch { /* sigue */ }
  if (!_igActorId) { try { const a = await graph('GET', `${acct()}/instagram_accounts`, { fields: 'id' }); _igActorId = a.data?.[0]?.id || ''; } catch { /* sigue */ } }
  // Con Page Token: cuenta business de la pagina + page-backed (crea una si no hay).
  if (!_igActorId) {
    const pt = await pageToken();
    if (pt) {
      try { _igActorId = grab(await graph('GET', M.pageId, { fields: 'instagram_business_account{id},connected_instagram_account{id}' }, pt)); } catch { /* sigue */ }
      if (!_igActorId) { try { const b = await graph('GET', `${M.pageId}/page_backed_instagram_accounts`, { fields: 'id' }, pt); _igActorId = b.data?.[0]?.id || ''; } catch { /* sigue */ } }
      if (!_igActorId) { try { const c = await graph('POST', `${M.pageId}/page_backed_instagram_accounts`, {}, pt); _igActorId = c.id || ''; } catch { /* sigue */ } }
    }
  }
  return _igActorId;
}

// Diagnostico: lista todas las cuentas de IG alcanzables (user token + page token).
export async function listIgAccounts() {
  const out = {};
  const tryGet = async (key, path, fields, tok) => { try { out[key] = await graph('GET', path, { fields }, tok); } catch (e) { out[key] = { error: e.message }; } };
  await tryGet('pageBusiness_user', M.pageId, 'instagram_business_account{id,username},connected_instagram_account{id,username}');
  await tryGet('adAccountIg', `${acct()}/instagram_accounts`, 'id,username');
  const pt = await pageToken();
  out.hasPageToken = Boolean(pt);
  if (pt) {
    await tryGet('pageBusiness_pageTok', M.pageId, 'instagram_business_account{id,username},connected_instagram_account{id,username}', pt);
    await tryGet('pageBacked_pageTok', `${M.pageId}/page_backed_instagram_accounts`, 'id,username', pt);
  }
  return out;
}

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
    // Placements MANUALES que cubrimos con imagen propia (story 9:16 + feed 1:1).
    // Excluye audience network (baja calidad en trafico frio) y deja cobertura 100%
    // para la customizacion por placement del creative (sin error de cobertura).
    // Advantage+ Audience: Meta encuentra el publico (ideal trafico frio + pixel).
    // OJO: con Advantage+ Audience NO se puede fijar age_max <65 como control duro
    // (#1870189); va amplio (18+) y el algoritmo sesga joven solo via el pixel/producto.
    targeting: {
      geo_locations: { countries },
      age_min: 18,
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions: ['feed', 'story', 'facebook_reels'],
      instagram_positions: ['stream', 'story', 'explore', 'reels'],
      targeting_automation: { advantage_audience: 1 },
    },
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
export function createSingleImageCreative({ name, imageHash, link, message, igActorId = '' }) {
  return graph('POST', `${acct()}/adcreatives`, {
    name,
    object_story_spec: {
      page_id: M.pageId,
      ...(igActorId ? { instagram_user_id: igActorId } : {}),
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
export function createPlacementImageCreative({ name, storyHash, feedHash, link, messages = [], titles = [], igActorId = '' }) {
  const bodies = (messages.length ? messages : ['']).slice(0, 5).map((t) => ({ text: t }));
  const titleSpec = titles.filter(Boolean).slice(0, 5).map((t) => ({ text: t }));
  return graph('POST', `${acct()}/adcreatives`, {
    name,
    object_story_spec: { page_id: M.pageId, ...(igActorId ? { instagram_user_id: igActorId } : {}) },
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
export function createCarouselCreative({ name, message, link, cards, igActorId = '' }) {
  return graph('POST', `${acct()}/adcreatives`, {
    name,
    object_story_spec: {
      page_id: M.pageId,
      ...(igActorId ? { instagram_user_id: igActorId } : {}),
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
  // Atribución por CLICK (7d) -> saca el view-through inflado (ATC/compras de gente que solo VIO el ad).
  const json = await graph('GET', `${objectId}/insights`, { fields, date_preset: datePreset, action_attribution_windows: ['7d_click'] });
  return json.data?.[0] || null;
}

// Diagnostico fino: huella del token (comparar sin exponerlo) + probar CON y SIN
// appsecret_proof (para aislar si el app_secret esta mal) + debug_token.
export async function diagnose() {
  const token = M.accessToken || '';
  const fp = token
    ? { len: token.length, head: token.slice(0, 10), tail: token.slice(-6), hasSpaces: /\s/.test(token), appSecretSet: !!M.appSecret, appSecretLen: (M.appSecret || '').length }
    : null;
  const call = async (path, withProof) => {
    try {
      const p = new URLSearchParams({ access_token: token, fields: 'id,name,account_status' });
      if (withProof && M.appSecret) p.append('appsecret_proof', crypto.createHmac('sha256', M.appSecret).update(token).digest('hex'));
      const r = await fetch(`${BASE}/${path}?${p.toString()}`);
      const j = await r.json();
      if (j.error) return { ok: false, error: `${j.error.message} (${j.error.code}/${j.error.error_subcode || 0})` };
      return { ok: true, data: j };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  const debugTok = async () => {
    try {
      const p = new URLSearchParams({ input_token: token, access_token: token });
      const r = await fetch(`${BASE}/debug_token?${p.toString()}`);
      const j = await r.json();
      if (j.error) return { ok: false, error: `${j.error.message} (${j.error.code}/${j.error.error_subcode || 0})` };
      return { ok: true, data: { type: j.data?.type, valid: j.data?.is_valid, appId: j.data?.app_id, scopes: j.data?.scopes, expires: j.data?.expires_at } };
    } catch (e) { return { ok: false, error: e.message }; }
  };
  return {
    tokenFingerprint: fp,
    meWithProof: await call('me', true),
    meNoProof: await call('me', false),
    debugToken: await debugTok(),
    adAccountNoProof: await call(acct(), false),
    pageNoProof: await call(M.pageId, false),
  };
}

// Intercambia el token corto por uno LONG-LIVED (~60 dias). Usa el app_id (del
// debug_token) + app_secret de la config + el token actual.
export async function exchangeLongLived() {
  if (!M.appSecret) throw new Error('Falta META_APP_SECRET');
  const dbg = await fetch(`${BASE}/debug_token?input_token=${M.accessToken}&access_token=${M.accessToken}`).then((r) => r.json());
  const appId = dbg.data?.app_id;
  if (!appId) throw new Error('No pude obtener app_id del token: ' + (dbg.error?.message || ''));
  const p = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: M.appSecret, fb_exchange_token: M.accessToken });
  const r = await fetch(`${BASE}/oauth/access_token?${p.toString()}`).then((x) => x.json());
  if (r.error) throw new Error(`${r.error.message} (${r.error.code})`);
  return { token: r.access_token, expiresInDays: r.expires_in ? Math.round(r.expires_in / 86400) : null, type: r.token_type };
}

// Parsea actions de Meta a ATC / compras. OJO: Meta devuelve el MISMO evento bajo varios
// action_type (add_to_cart, offsite_conversion.fb_pixel_add_to_cart, omni_add_to_cart…).
// Si sumás todos, contás 2-3x el mismo carrito. Elegimos UN action_type canónico por métrica.
export function parseActions(row) {
  const byType = {};
  for (const a of row?.actions || []) byType[a.action_type] = Number(a.value) || 0;
  const pick = (types) => { for (const t of types) if (byType[t] != null) return byType[t]; return 0; };
  return {
    addToCart: pick(['omni_add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart', 'web_add_to_cart']),
    purchases: pick(['omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'purchase', 'web_purchase']),
  };
}

// Insights normalizados EN VIVO de una campaña (dedup + click-attribution).
export async function getCampaignInsights(campaignId) {
  try { return normInsights(await getInsights(campaignId)); } catch { return null; }
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
    'insights.date_preset(maximum).action_attribution_windows(7d_click){impressions,clicks,ctr,cpc,spend,actions}';
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
    'insights.date_preset(maximum).action_attribution_windows(7d_click){impressions,clicks,ctr,spend,actions}';
  const json = await graph('GET', `${campaignId}/ads`, { fields, limit: 50 });
  return (json.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    effectiveStatus: a.effective_status,
    thumbnail: a.creative?.image_url || a.creative?.thumbnail_url || null,
    insights: normInsights(a.insights?.data?.[0]),
  }));
}
