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
    sys: `You are a streetwear stylist for a youth/street brand. Look at this fitpic and extract its STYLE DNA as GUIDANCE (not a literal copy). Capture what makes the look — the lane/vibe, the top type, the SNEAKERS, the ACCESSORIES, the model's vibe/energy (e.g. moreno street, clean prep), and the palette. Ignore the bottoms (we use our own denim shorts) and the background.`,
    ask: 'Return ONLY JSON with short values: {"lane":"the vibe/caliber + the kinds of brands","top":"top/layer type (no need to copy logos)","sneakers":"the sneakers you see (brand+colorway)","accessories":"caps, chains, socks, watch, etc.","vibe":"the model energy/casting vibe (e.g. moreno youthful street, clean minimal)","palette":"main colors"}',
    fields: ['lane', 'top', 'sneakers', 'accessories', 'vibe', 'palette'],
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

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Elige n referencias activas de un TIPO para un producto. Excluye las marcadas
// "evitar", pone los favoritos primero, y para OUTFIT prioriza las no usadas por ese
// producto (variedad). Devuelve [{ id, b64, dna, type }].
export async function pickRefs({ shopifyProductId = null, n = 1, type = 'outfit' } = {}) {
  const refs = await Reference.find({ active: true, avoid: { $ne: true }, type }).select('+imageData').lean();
  if (!refs.length) return [];

  let ordered;
  if (type === 'outfit' && shopifyProductId != null) {
    const [cs, ks] = await Promise.all([
      Creative.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
      Carousel.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
    ]);
    const usedIds = new Set([...cs, ...ks].map((d) => String(d.referenceId)));
    ordered = [...shuffle(refs.filter((r) => !usedIds.has(String(r._id)))), ...shuffle(refs.filter((r) => usedIds.has(String(r._id))))];
  } else {
    ordered = shuffle(refs);
  }
  ordered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)); // favoritos primero
  const chosen = ordered.slice(0, Math.min(n, ordered.length));

  const out = [];
  for (const r of chosen) {
    let brief = r.styleDna || '';
    if (!brief) {
      const ext = await extractRefDna(r.imageData, r.type || 'outfit');
      brief = ext.brief;
      if (brief) await Reference.updateOne({ _id: r._id }, { $set: { styleDna: brief, dna: ext.struct || {} } });
    }
    out.push({ id: String(r._id), b64: r.imageData, dna: brief, type: r.type || 'outfit' });
  }
  return out;
}

// Extrae y guarda el ADN de una referencia YA (para mostrarlo al subir / cambiar tipo).
export async function extractAndStore(refId) {
  const r = await Reference.findById(refId).select('+imageData').lean();
  if (!r?.imageData) return null;
  const ext = await extractRefDna(r.imageData, r.type || 'outfit');
  await Reference.updateOne({ _id: refId }, { $set: { styleDna: ext.brief, dna: ext.struct || {} } });
  return ext;
}

// Una referencia de ESCENA (o null) para que el director la use como locacion.
export async function pickScene(shopifyProductId = null) {
  const [s] = await pickRefs({ shopifyProductId, n: 1, type: 'scene' });
  return s || null;
}
