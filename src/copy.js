import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM = `You write ad copy for CAROTA, a US streetwear brand (denim shorts, drops).
Audience: young urban men (women buy too), streetwear culture. The creatives are
candid iPhone fitpics, not glossy ads. Your copy must feel ORGANIC and native to
the feed — like a real caption, never corporate or salesy. Short, punchy, confident,
a little understated. No hashtags spam, no excessive emojis (0-1 max), no clickbait.`;

const INSTRUCTION = `Return ONLY JSON:
{
  "primaryText": "<1-2 short lines, the caption above the ad. Native, scroll-stopping, hints at the drop/fit. Max ~120 chars>",
  "headline": "<very short, max ~5 words, punchy>"
}
Write in English (US store). Make it specific to the product when possible.`;

// Genera copy nativo para un creative.
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
  return {
    primaryText: String(parsed.primaryText || '').slice(0, 300),
    headline: String(parsed.headline || '').slice(0, 60),
  };
}
