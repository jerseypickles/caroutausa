import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM = `You write ad copy for CAROTA, a US streetwear brand (denim shorts, drops).
Audience: young urban men (women buy too), streetwear culture. The creatives are
candid iPhone fitpics, not glossy ads. Your copy must feel ORGANIC and native to
the feed — like a real caption, never corporate or salesy. Short, punchy, confident,
a little understated. No hashtags spam, no excessive emojis (0-1 max), no clickbait.`;

// Meta testea hasta 5 primary texts + 5 headlines por ad y muestra el mejor por
// usuario -> generamos VARIAS variaciones distintas entre si (mas variedad = mas
// optimizacion). Pedimos 3 de cada una con angulos diferentes.
const INSTRUCTION = `Return ONLY JSON with DISTINCT variations Meta can A/B test:
{
  "primaryTexts": ["<v1>", "<v2>", "<v3>"],   // 3 different captions above the ad, each 1-2 short lines, native and scroll-stopping, max ~120 chars. Vary the angle (one benefit-led, one hype/drop, one casual/relatable). No duplicates.
  "headlines": ["<h1>", "<h2>", "<h3>"]        // 3 different headlines, each very short (max ~5 words), punchy. No duplicates.
}
Write in English (US store). Make them specific to the product when possible.`;

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
