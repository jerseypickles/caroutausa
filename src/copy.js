import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM = `You write scroll-stopping ad copy for CAROTA, a US streetwear brand (denim shorts, drops).
Audience: young urban men (women buy too), streetwear culture. The creatives are candid
iPhone fitpics. Copy must feel ORGANIC and native to the feed — a real caption, never
corporate or salesy. It must have a HOOK and PERSONALITY — confident, a little bold, with
attitude. NEVER flat, generic, or boring ("Shop now", "Great shorts" = banned). Each
primary text opens with a hook that earns the next second of attention. Include exactly
ONE tasteful emoji per primary text that fits streetwear culture. No hashtag spam, no
clickbait, no walls of text.`;

// Meta testea hasta 5 primary texts + 5 headlines por ad y muestra el mejor por usuario
// -> generamos 5 de cada una, distintas entre si y con angulos diferentes (mas variedad
// = mas optimizacion).
const INSTRUCTION = `Return ONLY JSON with 5 DISTINCT, NON-FLAT variations Meta can A/B test:
{
  "primaryTexts": ["<v1>","<v2>","<v3>","<v4>","<v5>"],  // 5 different captions, each 1-2 short lines, native, with a HOOK + exactly ONE emoji, max ~120 chars. Use a DIFFERENT angle each: 1) benefit/fit-led, 2) hype/drop energy, 3) casual/relatable POV, 4) bold/confident flex, 5) FOMO/scarcity. No duplicates, none generic.
  "headlines": ["<h1>","<h2>","<h3>","<h4>","<h5>"]       // 5 different headlines, each very short (max ~5 words), punchy with attitude. No duplicates.
}
Write in English (US store). Be specific to the product/wash when possible.`;

function clean(arr, max, n) {
  const out = [...new Set((Array.isArray(arr) ? arr : []).map((s) => String(s || '').trim()).filter(Boolean))].map((s) => s.slice(0, max));
  return out.slice(0, n);
}

// $set para editar copy desde QC: acepta arrays (primaryTexts/headlines) o singular
// legacy, y mantiene sincronizados los campos singles (= primer elemento del array).
export function buildCopyUpdate(body = {}) {
  const update = { 'copy.edited': true };
  if (Array.isArray(body.primaryTexts)) { const a = clean(body.primaryTexts, 300, 5); update['copy.primaryTexts'] = a; update['copy.primaryText'] = a[0] || ''; }
  else if (typeof body.primaryText === 'string') { const v = body.primaryText.slice(0, 300); update['copy.primaryText'] = v; update['copy.primaryTexts'] = v ? [v] : []; }
  if (Array.isArray(body.headlines)) { const a = clean(body.headlines, 60, 5); update['copy.headlines'] = a; update['copy.headline'] = a[0] || ''; }
  else if (typeof body.headline === 'string') { const v = body.headline.slice(0, 60); update['copy.headline'] = v; update['copy.headlines'] = v ? [v] : []; }
  return update;
}

// Genera el HOOK de texto que va SOBRE la foto: una frase de beneficio/actitud ultra
// corta (NO el nombre del producto, NO precio) + un descriptor de fit para el callout.
export async function generateHook({ product, wash }) {
  try {
    const r = await client.chat.completions.create({
      model: config.judgeModel,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You write ultra-short TEXT-OVERLAY hooks for streetwear denim-shorts fitpic ads. Benefit/attitude with streetwear energy. NEVER the product name, NEVER a price.' },
        { role: 'user', content: `Return ONLY JSON {"hook":"a 2-4 word UPPERCASE benefit/attitude hook, can be two short punchy phrases (e.g. \\"LIGHT. LOOSE.\\", \\"WIDE LEG SZN\\", \\"ZERO EFFORT\\", \\"BAGGY SEASON\\", \\"JUST RIGHT.\\"), no product name, no price","fit":"a 1-2 word fit/spec descriptor in UPPERCASE (e.g. WIDE LEG, BAGGY, RELAXED, 14OZ DENIM)"}. Product: ${product || 'denim shorts'}, wash: ${wash || ''}.` },
      ],
    });
    const j = JSON.parse(r.choices?.[0]?.message?.content || '{}');
    return { hook: String(j.hook || 'LIGHT. LOOSE.').slice(0, 28), fit: String(j.fit || 'WIDE LEG').slice(0, 20) };
  } catch (e) {
    console.error('[copy] generateHook fallo:', e.message);
    return { hook: 'WIDE LEG SZN', fit: 'RELAXED' };
  }
}

// Genera copy nativo (varias variaciones) para un creative.
export async function generateCopy({ product, wash, angle, description }) {
  const ctx = [
    product && `Product: ${product}`,
    wash && `Wash: ${wash}`,
    angle && `Creative angle: ${angle}`,
    description && `Details: ${description}`,
  ].filter(Boolean).join('\n');

  const completion = await client.chat.completions.create({
    model: config.judgeModel,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${INSTRUCTION}\n\n${ctx}` },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Copy no devolvio JSON'); }
  // backward-compat: si vino el formato viejo (singular), lo metemos en el array.
  const primaryTexts = clean(parsed.primaryTexts?.length ? parsed.primaryTexts : [parsed.primaryText], 300, 5);
  const headlines = clean(parsed.headlines?.length ? parsed.headlines : [parsed.headline], 60, 5);
  return {
    primaryTexts, headlines,
    primaryText: primaryTexts[0] || '', // compat con codigo/datos viejos
    headline: headlines[0] || '',
  };
}
