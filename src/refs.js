import OpenAI from 'openai';
import { Reference } from './models/reference.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import { config } from './config.js';
import { dataUrl } from './imgutil.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Extracción ESTRUCTURADA según el tipo: devuelve campos para VER qué captó la ref +
// un brief para el director. Cada tipo captura su dimensión.
const EXTRACT = {
  outfit: {
    sys: `You are a streetwear stylist for a youth/street brand. Look at this fitpic and extract its STYLE DNA as GUIDANCE (not a literal copy). Capture what makes the look — the lane/vibe, the top type, the FIT/SILHOUETTE, the SNEAKERS, the ACCESSORIES, the model's vibe/energy (e.g. moreno street, clean prep), and the palette. Ignore the bottoms (we use our own denim shorts) and the background.`,
    ask: 'Return ONLY JSON with short values: {"lane":"the vibe/caliber + the kinds of brands","top":"top/layer type","graphic":"the ARTWORK/PRINT on the top — describe its THEME and STYLE so a similar ORIGINAL one can be designed (e.g. \\"money/$100-bill print\\", \\"skateboard photo-collage\\", \\"cartoon character\\", \\"gothic text\\", \\"abstract art\\", \\"vintage band-style\\") — IGNORE any brand name; write \\"none\\" if the top is blank","fit":"the SILHOUETTE/FIT — e.g. fitted/slim, regular, oversized/boxy, baggy/relaxed","sneakers":"the sneakers you see (brand+colorway)","accessories":"caps, chains, socks, watch, bag, etc.","vibe":"the model energy/casting vibe","palette":"main colors","family":"classify the lane into ONE word: edge, clean, or versatile"}',
    fields: ['lane', 'top', 'graphic', 'fit', 'sneakers', 'accessories', 'vibe', 'palette'],
  },
  scene: {
    sys: `You are a photographer. Look ONLY at the LOCATION / SCENE and its light & mood (NOT the person, outfit, pose or product). Capture it as a brief to recreate a similar setting.`,
    ask: 'Return ONLY JSON: {"location":"type of place","elements":"key architecture/objects","light":"lighting direction & softness","mood":"overall mood/energy","palette":"main colors"}. Ignore the person, clothes and product.',
    fields: ['location', 'elements', 'light', 'mood', 'palette'],
  },
  pose: {
    sys: `You are a creative director. Look ONLY at the POSE and ENERGY of the subject (NOT the outfit, scene or product).`,
    ask: 'Return ONLY JSON: {"stance":"body language/stance","framing":"crop/angle","energy":"attitude/energy"}. Ignore clothes, place and product.',
    fields: ['stance', 'framing', 'energy'],
  },
};

// Extrae el ADN estructurado de una referencia segun su tipo. Devuelve { struct, brief }.
export async function extractRefDna(b64, type = 'outfit') {
  if (!b64) return { struct: null, brief: '' };
  const e = EXTRACT[type] || EXTRACT.outfit;
  try {
    const r = await openai.chat.completions.create({
      model: config.judgeModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: e.sys },
        { role: 'user', content: [{ type: 'text', text: e.ask }, { type: 'image_url', image_url: { url: dataUrl(b64) } }] },
      ],
    });
    const struct = JSON.parse(r.choices?.[0]?.message?.content || '{}');
    const brief = e.fields.map((f) => struct[f]).filter(Boolean).join(' · ').slice(0, 500);
    return { struct, brief };
  } catch (err) {
    console.error('[refs] extractRefDna fallo:', err.message);
    return { struct: null, brief: '' };
  }
}

// Muestreo aleatorio PONDERADO sin repetir: cada item entra con prob ~ su peso (ruleta).
// Da variedad real con bias suave, en vez de "el mejor score siempre gana".
function weightedSampleDistinct(arr, weightFn, n) {
  const pool = arr.map((r) => ({ r, w: Math.max(0.01, weightFn(r)) }));
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let x = Math.random() * total, idx = 0;
    for (; idx < pool.length - 1; idx++) { x -= pool[idx].w; if (x <= 0) break; }
    out.push(pool[idx].r);
    pool.splice(idx, 1);
  }
  return out;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Familia de vibe por WASH (matching ref↔producto): oscuros->edge, claros->clean, medios->versatile.
const WASH_FAMILY = { onyx: 'edge', storm: 'edge', smoke: 'edge', bone: 'clean', ice: 'clean', salt: 'clean', fog: 'versatile', dusk: 'versatile' };
export function washFamily(wash) {
  if (!wash) return null;
  return WASH_FAMILY[String(wash).toLowerCase().trim()] || 'versatile';
}

// Elige n referencias activas de un TIPO para un producto. Excluye "evitar"; ordena por
// prioridad: favorito > MATCHEA el wash (lane↔wash) > no usada por el producto (variedad).
// Devuelve [{ id, b64, dna, type }].
export async function pickRefs({ shopifyProductId = null, wash = null, n = 1, type = 'outfit' } = {}) {
  // MULTI-TAG: una ref entra si su array `types` incluye el tipo pedido (compat: o `type`).
  const refs = await Reference.find({ active: true, avoid: { $ne: true }, $or: [{ types: type }, { type }] }).select('+imageData').lean();
  if (!refs.length) return [];

  let usedIds = new Set();
  if (type === 'outfit' && shopifyProductId != null) {
    const [cs, ks] = await Promise.all([
      Creative.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
      Carousel.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
    ]);
    usedIds = new Set([...cs, ...ks].map((d) => String(d.referenceId)));
  }
  const fam = type === 'outfit' ? washFamily(wash) : null;
  const structOf = (r) => r.dna?.[type] || r.dna || {}; // dna por tipo (o legacy)
  // Peso SUAVE -> pick aleatorio ponderado (variedad real). Familia = preferencia leve (+1);
  // no-usada por el producto +1.5; favorito +3.
  const weight = (r) => 1
    + (usedIds.has(String(r._id)) ? 0 : 1.5)
    + (fam && structOf(r).family === fam ? 1 : 0)
    + (r.favorite ? 3 : 0);
  const chosen = weightedSampleDistinct(refs, weight, Math.min(n, refs.length));

  const out = [];
  for (const r of chosen) {
    let brief = r.briefs?.[type] || (type === 'outfit' ? r.styleDna : '') || '';
    if (!brief) { // lazy: extrae ese tipo si falta
      const ext = await extractRefDna(r.imageData, type);
      brief = ext.brief;
      if (brief) await Reference.updateOne({ _id: r._id }, { $set: { [`briefs.${type}`]: brief, [`dna.${type}`]: ext.struct || {} } });
    }
    out.push({ id: String(r._id), b64: r.imageData, dna: brief, type });
  }
  return out;
}

// Extrae y guarda el ADN de una ref para CADA tipo que tiene (multi-tag).
export async function extractAndStore(refId) {
  const r = await Reference.findById(refId).select('+imageData').lean();
  if (!r?.imageData) return null;
  const types = (r.types?.length ? r.types : [r.type || 'outfit']);
  const dna = {}, briefs = {};
  for (const t of types) {
    const ext = await extractRefDna(r.imageData, t);
    dna[t] = ext.struct || {};
    briefs[t] = ext.brief || '';
  }
  await Reference.updateOne({ _id: refId }, { $set: {
    types, type: types[0], dna, briefs, styleDna: briefs.outfit || briefs[types[0]] || '',
  } });
  return { types, dna, briefs };
}

// Una referencia de ESCENA (o null) para que el director la use como locacion.
export async function pickScene(shopifyProductId = null) {
  const [s] = await pickRefs({ shopifyProductId, n: 1, type: 'scene' });
  return s || null;
}

// Una referencia de POSE (o null) para que el director la use como pose/encuadre.
export async function pickPose(shopifyProductId = null) {
  const [p] = await pickRefs({ shopifyProductId, n: 1, type: 'pose' });
  return p || null;
}
