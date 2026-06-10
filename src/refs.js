import OpenAI from 'openai';
import { Reference } from './models/reference.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import { config } from './config.js';
import { dataUrl } from './imgutil.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Prompts de extracción SEGÚN el tipo de referencia (cada uno inspira una dimensión).
const EXTRACT = {
  outfit: {
    sys: `You are a streetwear stylist. Distill the STYLE DNA of this outfit — the lane/vibe, the caliber and the kinds of BRANDS it signals, the TYPE of top/layers, the FOOTWEAR style and sneaker brands that fit, the accessories, and the color palette. This is GUIDANCE to design fresh outfits in the same spirit, NOT a literal description to copy. Ignore the bottoms (we always use our own denim shorts) and the background.`,
    ask: 'Give a compact style-DNA brief in 1-2 sentences (vibe + key TOP/layer types + footwear/sneaker lane + accessories + palette). No preamble.',
  },
  scene: {
    sys: `You are a photographer. Describe ONLY the LOCATION / SCENE and its light & mood as a brief to recreate a similar SETTING — NOT the person, outfit, pose or product. Capture: the type of place, the key elements/architecture, the lighting and color mood, the overall vibe.`,
    ask: 'Give a compact SCENE brief in 1-2 sentences (location type + key elements + lighting & mood + palette). Ignore the person, the clothes and the product.',
  },
  pose: {
    sys: `You are a creative director. Describe ONLY the POSE and ENERGY of the subject — NOT the outfit, scene or product. Capture: the stance/body language, the framing/crop, and the energy/attitude.`,
    ask: 'Give a compact POSE brief in 1 sentence (stance + framing + energy). Ignore the clothes, the place and the product.',
  },
};

// Extrae el ADN de una referencia segun su TIPO (outfit / scene / pose). Cacheado.
export async function extractRefDna(b64, type = 'outfit') {
  if (!b64) return '';
  const e = EXTRACT[type] || EXTRACT.outfit;
  try {
    const r = await openai.chat.completions.create({
      model: config.judgeModel,
      messages: [
        { role: 'system', content: e.sys },
        { role: 'user', content: [{ type: 'text', text: e.ask }, { type: 'image_url', image_url: { url: dataUrl(b64) } }] },
      ],
    });
    return (r.choices?.[0]?.message?.content || '').trim().slice(0, 400);
  } catch (err) {
    console.error('[refs] extractRefDna fallo:', err.message);
    return '';
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
    let dna = r.styleDna || '';
    if (!dna) {
      dna = await extractRefDna(r.imageData, r.type || 'outfit');
      if (dna) await Reference.updateOne({ _id: r._id }, { $set: { styleDna: dna } });
    }
    out.push({ id: String(r._id), b64: r.imageData, dna, type: r.type || 'outfit' });
  }
  return out;
}

// Una referencia de ESCENA (o null) para que el director la use como locacion.
export async function pickScene(shopifyProductId = null) {
  const [s] = await pickRefs({ shopifyProductId, n: 1, type: 'scene' });
  return s || null;
}
