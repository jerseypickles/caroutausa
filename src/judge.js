import OpenAI from 'openai';
import { config } from './config.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM = `You are a denim QC fidelity inspector for a streetwear brand.
You receive TWO images:
  - Image 1: the ORIGINAL product (the exact jean/short that MUST be preserved).
  - Image 2: an AI-generated ad photo of a model wearing what should be the SAME product.
Judge how faithfully Image 2 preserves the ORIGINAL garment's design.
Focus ONLY on the garment, checking: denim wash/color, fade pattern, distressing
and rips (placement + amount), stitching, hardware/buttons/rivets/any chains,
cut/fit, length, and hem finish (raw/cutoff/clean).
IGNORE scene, background, model, pose and lighting — those are supposed to change.
Be strict: if a design element is missing, moved, restyled or recolored, call it out.`;

const INSTRUCTION = `Return ONLY a JSON object with this exact shape:
{
  "score": <integer 0-100, where 100 = garment is identical in design>,
  "verdict": "pass" | "fail",
  "issues": [<short strings naming each design difference; empty if none>],
  "summary": "<one concise sentence>"
}
Set "verdict" to "pass" only if score >= ${config.fidelityPass}.`;

// Compara la imagen original (URL) contra la generada (base64) y devuelve el veredicto.
export async function judgeFidelity({ sourceImageUrl, b64 }) {
  const dataUrl = `data:image/png;base64,${b64}`;

  const completion = await client.chat.completions.create({
    model: config.judgeModel,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: INSTRUCTION },
          { type: 'text', text: 'Image 1 — ORIGINAL product:' },
          { type: 'image_url', image_url: { url: sourceImageUrl } },
          { type: 'text', text: 'Image 2 — AI-generated:' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El juez no devolvio JSON valido');
  }

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  const verdict = parsed.verdict === 'pass' || score >= config.fidelityPass ? 'pass' : 'fail';
  return {
    score,
    verdict,
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 12).map(String) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };
}
