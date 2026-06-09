import OpenAI from 'openai';
import { config } from './config.js';
import { dataUrl } from './imgutil.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM = `You are a senior performance-creative strategist for CAROTA, a US
streetwear brand (denim shorts). You evaluate ONE ad creative image for paid social
(Meta Reels/Feed) targeting a young streetwear audience. CAROTA's edge is ORGANIC
realism — candid iPhone fitpics that don't look like ads; the organic look IS the hook.
Score the creative as a scroll-stopping ad. Be calibrated and honest — these are
estimates, not guarantees.`;

const INSTRUCTION = `Return ONLY a JSON object:
{
  "hook": <0-100, strength of the first-frame grab: face, attitude, energy>,
  "scrollStop": <0-100, pattern-interrupt: would it stop the thumb mid-scroll>,
  "productFocus": <0-100, how clearly and prominently the denim shorts read>,
  "ugcFeel": <0-100, authentic organic UGC feel; higher = more native, less ad-like>,
  "fatigueRisk": <0-100, how generic/forgettable it is, likely to fatigue fast; LOWER is better>,
  "overall": <0-100, composite for this audience>,
  "confidence": "alta" | "media" | "baja",
  "summary": "<one concise sentence, Spanish>",
  "feedback": [
    { "label": "<short, e.g. Composición/Textura/Iluminación/Desgaste>", "level": "ok"|"warn"|"bad", "note": "<short, Spanish>" }
  ],
  "attention": {
    "heat": "alto" | "medio" | "bajo",
    "zones": [
      { "label": "Cara / Cabeza", "percent": <int>, "x": <0-1>, "y": <0-1> },
      { "label": "Upper Body",     "percent": <int>, "x": <0-1>, "y": <0-1> },
      { "label": "Producto (Short)","percent": <int>, "x": <0-1>, "y": <0-1> },
      { "label": "Fondo",          "percent": <int>, "x": <0-1>, "y": <0-1> }
    ]
  }
}
For "attention": estimate where a viewer's eye lands first (visual saliency). The four
percents should sum to ~100. x,y are the approximate normalized center (0=left/top,
1=right/bottom) of each zone IN THIS IMAGE so a heatmap can be drawn. "heat" answers:
for a CLOTHING ad, does enough attention reach the product? (alto = good for selling
the garment). Give 2-4 feedback items. Write summary and notes in Spanish.`;

function clamp(n) { return Math.max(0, Math.min(100, Math.round(Number(n) || 0))); }

// Analiza un creative (imagen base64) y devuelve los scores de performance estimados.
export async function analyzeImage({ b64, product, wash }) {
  const ctx = [product && `Product: ${product}`, wash && `Wash: ${wash}`].filter(Boolean).join('\n');

  const completion = await client.chat.completions.create({
    model: config.judgeModel,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${INSTRUCTION}\n\n${ctx}` },
          { type: 'image_url', image_url: { url: dataUrl(b64) } },
        ],
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let p;
  try { p = JSON.parse(raw); } catch { throw new Error('Analyzer no devolvio JSON'); }
  return {
    status: 'done',
    hook: clamp(p.hook), scrollStop: clamp(p.scrollStop), productFocus: clamp(p.productFocus),
    ugcFeel: clamp(p.ugcFeel), fatigueRisk: clamp(p.fatigueRisk), overall: clamp(p.overall),
    confidence: ['alta', 'media', 'baja'].includes(p.confidence) ? p.confidence : 'media',
    summary: typeof p.summary === 'string' ? p.summary : '',
    feedback: Array.isArray(p.feedback) ? p.feedback.slice(0, 4).map((f) => ({
      label: String(f.label || '').slice(0, 30),
      level: ['ok', 'warn', 'bad'].includes(f.level) ? f.level : 'ok',
      note: String(f.note || '').slice(0, 220),
    })) : [],
    attention: {
      heat: ['alto', 'medio', 'bajo'].includes(p.attention?.heat) ? p.attention.heat : 'medio',
      zones: Array.isArray(p.attention?.zones) ? p.attention.zones.slice(0, 4).map((z) => ({
        label: String(z.label || '').slice(0, 24),
        percent: clamp(z.percent),
        x: Math.max(0, Math.min(1, Number(z.x) || 0.5)),
        y: Math.max(0, Math.min(1, Number(z.y) || 0.5)),
      })) : [],
    },
    analyzedAt: new Date(),
  };
}
