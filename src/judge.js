import OpenAI from 'openai';
import { config } from './config.js';
import { dataUrl as toDataUrl } from './imgutil.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM = `You are a denim QC fidelity inspector for a streetwear brand.
You receive TWO images:
  - Image 1: the ORIGINAL product (the exact jean/short that MUST be preserved).
  - Image 2: an AI-generated ad photo of a model wearing what should be the SAME product.
Judge how faithfully Image 2 preserves the ORIGINAL garment, on TWO separate axes:
  A) DESIGN: denim wash/color, fade pattern, distressing/rips (placement + amount),
     stitching, hardware/buttons/rivets, and hem finish (raw/cutoff/clean).
  B) FIT / SILHOUETTE: how WIDE vs SLIM the short is through the hip and thigh, the
     leg width/opening (wide-straight vs tapered/slim), the LENGTH (where the hem
     hits the leg), and the rise. This is about shape and proportions, not wash.
IGNORE scene, background, model, pose and lighting — those are supposed to change.
Be strict on BOTH axes: a short rendered slimmer, baggier, longer or shorter than the
original is a FIT failure even if the wash is perfect.`;

function instruction(fitSpec) {
  return `Return ONLY a JSON object with this exact shape:
{
  "score": <integer 0-100, DESIGN fidelity, 100 = identical design>,
  "fitScore": <integer 0-100, FIT/SILHOUETTE fidelity, 100 = exact same width/length/cut>,
  "verdict": "pass" | "fail",
  "issues": [<short strings naming each DESIGN difference; empty if none>],
  "fitIssues": [<short strings naming each FIT/SILHOUETTE difference, e.g. "rendered slimmer", "too long", "tapered leg"; empty if none>],
  "summary": "<one concise sentence covering both>"
}
${fitSpec ? `The product's TRUE fit/silhouette (from the brand size guide) is: "${fitSpec}". Judge Image 2's shorts against BOTH Image 1 and this fit.\n` : ''}Set "verdict" to "pass" only if score >= ${config.fidelityPass} AND fitScore >= ${config.fitPass}.`;
}

// Compara la imagen original (URL) contra la generada (base64) y devuelve el veredicto
// en dos ejes: diseño (score) y fit/silueta (fitScore). fitSpec ancla el fit real.
export async function judgeFidelity({ sourceImageUrl, b64, fitSpec = '' }) {
  const dataUrl = toDataUrl(b64);

  const completion = await client.chat.completions.create({
    model: config.judgeModel,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction(fitSpec) },
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

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const score = clamp(parsed.score);
  const fitScore = parsed.fitScore != null ? clamp(parsed.fitScore) : score;
  const verdict = score >= config.fidelityPass && fitScore >= config.fitPass ? 'pass' : 'fail';
  return {
    score,
    fitScore,
    verdict,
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 12).map(String) : [],
    fitIssues: Array.isArray(parsed.fitIssues) ? parsed.fitIssues.slice(0, 8).map(String) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };
}
