import OpenAI from 'openai';
import { Reference } from './models/reference.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import { config } from './config.js';
import { dataUrl } from './imgutil.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Extrae el "ADN de estilo" de una referencia (vibe, nivel/marcas, tipo de piezas,
// estilo de zapatillas, accesorios, paleta) como GUIA para inspirar outfits frescos,
// NO una descripcion para clonar. Se cachea por referencia.
export async function extractRefDna(b64) {
  if (!b64) return '';
  try {
    const r = await openai.chat.completions.create({
      model: config.judgeModel,
      messages: [
        {
          role: 'system',
          content: `You are a streetwear stylist. Look at this outfit reference and distill its STYLE DNA — the lane/vibe, the caliber and the kinds of BRANDS it signals, the TYPE of top/layers, the FOOTWEAR style and sneaker brands that fit, the accessories, and the color palette. This is GUIDANCE to design fresh outfits in the same spirit, NOT a literal description to copy. Ignore the bottoms (we always use our own denim shorts) and the background.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Give a compact style-DNA brief in ONE or two sentences (vibe + key piece types + footwear/sneaker lane + accessories + palette). No preamble.' },
            { type: 'image_url', image_url: { url: dataUrl(b64) } },
          ],
        },
      ],
    });
    return (r.choices?.[0]?.message?.content || '').trim().slice(0, 400);
  } catch (e) {
    console.error('[refs] extractRefDna fallo:', e.message);
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

// Elige n referencias activas para un producto, PRIORIZANDO las que ese producto
// todavia NO uso (variedad real, no siempre la misma). Devuelve [{ id, b64 }].
export async function pickRefs({ shopifyProductId = null, n = 1 } = {}) {
  const refs = await Reference.find({ active: true }).select('+imageData').lean();
  if (!refs.length) return [];

  let usedIds = new Set();
  if (shopifyProductId != null) {
    const [cs, ks] = await Promise.all([
      Creative.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
      Carousel.find({ shopifyProductId, referenceId: { $nin: [null, ''] } }).select('referenceId').lean(),
    ]);
    usedIds = new Set([...cs, ...ks].map((d) => String(d.referenceId)));
  }

  const unused = shuffle(refs.filter((r) => !usedIds.has(String(r._id))));
  const used = shuffle(refs.filter((r) => usedIds.has(String(r._id))));
  const ordered = [...unused, ...used]; // primero las no usadas
  const chosen = ordered.slice(0, Math.min(n, ordered.length));

  // Asegura el ADN de estilo (extrae y cachea la primera vez).
  const out = [];
  for (const r of chosen) {
    let dna = r.styleDna || '';
    if (!dna) {
      dna = await extractRefDna(r.imageData);
      if (dna) await Reference.updateOne({ _id: r._id }, { $set: { styleDna: dna } });
    }
    out.push({ id: String(r._id), b64: r.imageData, dna });
  }
  return out;
}
