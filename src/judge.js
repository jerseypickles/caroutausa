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
// Chequeo focalizado para la variante CON HOOK: compara el SHORT entre la version limpia
// y la del hook, ignorando el texto. Devuelve { same, note }. Si el short cambió -> false.
export async function judgeHookFidelity(cleanB64, hookB64) {
  try {
    const r = await client.chat.completions.create({
      model: config.judgeModel,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Two versions of the SAME fashion photo. The second has a TEXT OVERLAY added in the empty space. IGNORE the text entirely. Compare ONLY the DENIM SHORTS (the product) and the rest of the photo: are the shorts IDENTICAL in wash/color, fade & whiskering pattern, length, hem and fit? And are the model, pose, outfit and background unchanged (except the added text)? Return JSON {"same": true or false, "note": "if not same, what specifically changed in the shorts or photo"}.' },
          { type: 'text', text: 'Image 1 — original (no text):' },
          { type: 'image_url', image_url: { url: toDataUrl(cleanB64) } },
          { type: 'text', text: 'Image 2 — with text overlay:' },
          { type: 'image_url', image_url: { url: toDataUrl(hookB64) } },
        ],
      }],
    });
    const j = JSON.parse(r.choices?.[0]?.message?.content || '{}');
    return { same: j.same !== false, note: String(j.note || '') };
  } catch (e) {
    console.error('[judge] judgeHookFidelity fallo:', e.message);
    return { same: true, note: 'check failed (no bloquea): ' + e.message }; // best-effort, no bloqueamos por un error del check
  }
}

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

// QC de VIDEO multi-frame: pasa el producto + N frames del clip JUNTOS y juzga (A) fidelidad
// del short y (B) MORPHING — que el short no se deforme/cambie ENTRE frames. Un solo call.
export async function judgeVideoFrames({ sourceImageUrl, frameB64s = [], fitSpec = '' }) {
  if (!frameB64s.length) return { score: null, morphScore: null, verdict: 'pass', issues: [] };
  const content = [
    { type: 'text', text: `You QC an AI-generated short VIDEO ad. Image 1 is the ORIGINAL denim short PRODUCT that must be preserved. The rest are FRAMES sampled across the video (a person wearing it, waist-down). Check TWO things:
A) FIDELITY: in each frame, do the shorts match the product — wash/fade, rips, hem, and FIT (width through hip/thigh, leg width, LENGTH/where the hem hits)?${fitSpec ? ` The product's true fit: "${fitSpec}".` : ''}
B) MORPHING / STABILITY: do the shorts stay IDENTICAL ACROSS the frames, or do they warp / morph / flicker — changing shape, wash, hem, seams or LENGTH from one frame to the next? Any melting, shifting seams, or length/width change between frames = morphing = FAIL.
Return ONLY JSON {"score": <0-100, WORST short fidelity across the frames>, "morphScore": <0-100, 100 = perfectly stable no morphing>, "verdict": "pass" | "fail", "issues": [<short strings naming fidelity OR morphing problems; empty if none>]}.` },
    { type: 'text', text: 'Image 1 — ORIGINAL product:' },
    { type: 'image_url', image_url: { url: sourceImageUrl } },
  ];
  frameB64s.forEach((b, i) => content.push({ type: 'text', text: `Video frame ${i + 1}:` }, { type: 'image_url', image_url: { url: toDataUrl(b) } }));
  try {
    const r = await client.chat.completions.create({ model: config.judgeModel, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] });
    const j = JSON.parse(r.choices?.[0]?.message?.content || '{}');
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const score = clamp(j.score);
    const morphScore = j.morphScore != null ? clamp(j.morphScore) : 100;
    return { score, morphScore, verdict: (score >= config.fidelityPass && morphScore >= 80) ? 'pass' : 'fail', issues: Array.isArray(j.issues) ? j.issues.slice(0, 8).map(String) : [] };
  } catch (e) {
    console.error('[judge] judgeVideoFrames:', e.message);
    return { score: null, morphScore: null, verdict: 'pass', issues: ['QC error: ' + e.message] }; // best-effort, no bloquea
  }
}
