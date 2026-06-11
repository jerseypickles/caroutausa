import { VideoClip } from './models/videoClip.js';
import { Product } from './models/product.js';
import { generateVariant, STORY_SIZE } from './openai.js';
import { GARMENT_LOCK, fitLock } from './angles.js';
import { directCreative } from './director.js';
import { planHook } from './hook.js';
import { pickRefs, pickScene } from './refs.js';
import { judgeFidelity } from './judge.js';
import { createVideoTask, getVideoTask, piapiConfigured } from './piapi.js';
import { config } from './config.js';

// Presets de movimiento SUTIL (nada de caminar/gestos -> no se ve IA). El movimiento de
// Seedance sale del prompt; entre start y last frame el delta ya es chico, así que pedimos
// micro-movimiento natural y que el short NO cambie.
export const MOTION_PRESETS = {
  'mirror-sway': 'Subtle realistic micro-movement: the person shifts their weight slightly and the fabric of the clothing sways naturally, very gentle handheld phone-camera motion. Photoreal candid fitpic.',
  'breath-fabric': 'Almost still, only a natural breathing motion and the clothing fabric settling softly, with a barely-there handheld camera drift. Photoreal.',
  'slow-push': 'The camera slowly and smoothly pushes in a little closer while the person stays mostly still with a tiny natural weight shift. Photoreal, cinematic but candid.',
};
const MOTION_GUARD = ' NO walking, NO big movements, NO morphing. The denim shorts keep the EXACT same shape, wash, rips, hem and length the whole time. Hands and face stay stable and natural.';

// Frame "last": el MISMO instante ~1s después (delta chico) para que Seedance interpole fiel.
function lastFramePrompt(productDescription = '') {
  return `${GARMENT_LOCK}
The SECOND image is a frame of this EXACT fitpic session. Generate the very NEXT frame about one second later: the SAME real person, SAME face, SAME outfit and graphic, SAME sneakers, SAME location, SAME lighting and color grading, SAME framing — with only a TINY natural change (a slight weight shift, a small head turn, the fabric settling, a subtle hand move). It must read as the immediate next moment of the same clip, NOT a different pose or camera angle. Keep the denim shorts EXACTLY the same. NO text overlay anywhere.${productDescription ? `\nProduct to preserve exactly: ${productDescription}` : ''}
Make it a REAL candid iPhone photo — natural grain and light, never an AI render.`;
}

// 1) FRAMES: genera start + last (ambos fieles a ref + producto), SIN hook bakeado.
export async function generateVideoFrames(clipId) {
  const clip = await VideoClip.findById(clipId).select('+referenceImageData').lean();
  if (!clip) return;
  try {
    const prod = clip.shopifyProductId ? await Product.findOne({ shopifyId: clip.shopifyProductId }).lean() : null;
    const fitSpec = prod?.fitSpec || clip.fitSpec || '';
    const productDescription = [clip.product, prod?.description].filter(Boolean).join('. ');
    const imageUrl = clip.sourceImageUrl;

    // Escena + dirección (mismo motor que los singles). El director copia la ref (estricto).
    const scene = await pickScene(clip.shopifyProductId).catch(() => null);
    const dir = await directCreative({
      product: clip.product, wash: clip.wash, angle: 'realista',
      refDna: clip.referenceDna || '', sceneDna: scene?.dna || '', mode: 'video',
    });
    const creativeDirection = dir?.text || '';

    // START frame (ref image -> copia el outfit; producto del GARMENT_LOCK). 9:16, sin hook.
    const start = await generateVariant({
      imageUrl, productBackUrl: '', angleId: 'realista', productDescription, creativeDirection,
      fitSpec, size: STORY_SIZE, referenceB64: clip.referenceImageData || null,
    });
    const startFid = await judgeFidelity({ sourceImageUrl: imageUrl, b64: start.b64, fitSpec }).catch(() => ({ score: null, issues: [] }));

    // LAST frame: delta chico DESDE el start (mantiene todo, interpola fiel).
    const last = await generateVariant({
      imageUrl, referenceB64: start.b64, productDescription, fitSpec,
      prompt: lastFramePrompt(productDescription), size: STORY_SIZE,
    });
    const lastFid = await judgeFidelity({ sourceImageUrl: imageUrl, b64: last.b64, fitSpec }).catch(() => ({ score: null, issues: [] }));

    // Hook: lo PLANEAMOS (texto+fuente) pero NO lo bakeamos -> va como overlay al final.
    let hook = null;
    try { hook = await planHook({ product: clip.product, wash: clip.wash, fitSpec }); } catch (e) {}

    await VideoClip.findByIdAndUpdate(clipId, {
      startImageData: start.b64, lastImageData: last.b64,
      startFidelity: startFid.score, lastFidelity: lastFid.score,
      fidelityIssues: [...(startFid.issues || []), ...(lastFid.issues || [])].slice(0, 6),
      castTag: dir?.castTag, sceneTag: dir?.sceneTag,
      hookLine: hook?.hookLine || null, fontTag: hook?.fontTag || null,
      stage: 'frames', genStatus: 'ready', error: null,
    });
  } catch (err) {
    console.error(`[video] frames fallo (${clipId}):`, err.message);
    await VideoClip.findByIdAndUpdate(clipId, { genStatus: 'failed', stage: 'failed', error: err.message });
  }
}

// 2) ANIMAR: manda start+last a Seedance (URLs públicas de nuestros frames).
export async function animateClip(clipId, { preset = 'mirror-sway' } = {}) {
  if (!piapiConfigured()) throw new Error('PIAPI_KEY no configurada');
  const clip = await VideoClip.findById(clipId).lean();
  if (!clip) throw new Error('clip no encontrado');
  const base = config.publicBaseUrl.replace(/\/$/, '');
  const startUrl = `${base}/api/video/${clipId}/start-frame`;
  const lastUrl = `${base}/api/video/${clipId}/last-frame`;
  const prompt = (MOTION_PRESETS[preset] || MOTION_PRESETS['mirror-sway']) + MOTION_GUARD;
  const taskId = await createVideoTask({
    imageUrls: [startUrl, lastUrl], prompt, duration: clip.duration || 5,
    aspectRatio: '9:16', resolution: '720p', fast: true,
  });
  await VideoClip.findByIdAndUpdate(clipId, { taskId, motionPreset: preset, motionPrompt: prompt, stage: 'animating', error: null });
  return taskId;
}

// 3) FINISH: pollea la task; cuando hay video lo baja y pasa a QC.
export async function finishAnimation(clipId) {
  const clip = await VideoClip.findById(clipId).lean();
  if (!clip?.taskId) return { done: false };
  const t = await getVideoTask(clip.taskId);
  if (t.status === 'failed') {
    await VideoClip.findByIdAndUpdate(clipId, { stage: 'failed', error: 'Seedance falló: ' + (t.error?.message || '') });
    return { done: true, failed: true };
  }
  if (!t.videoUrl) return { done: false, status: t.status };
  // bajamos el mp4 para ser dueños (la URL de PiAPI puede expirar).
  let videoData = null;
  try {
    const res = await fetch(t.videoUrl);
    if (res.ok) videoData = Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (e) {}
  await VideoClip.findByIdAndUpdate(clipId, { videoUrl: t.videoUrl, videoData, stage: 'qc' });
  return { done: true, videoUrl: t.videoUrl };
}

// Cron liviano: avanza las tasks en 'animating'.
let _videoTimer = null;
export function startVideoCron() {
  if (_videoTimer || !piapiConfigured()) return;
  const run = async () => {
    const pend = await VideoClip.find({ stage: 'animating', taskId: { $ne: null } }).select('_id').lean();
    for (const c of pend) await finishAnimation(c._id).catch((e) => console.error('[video] finish:', e.message));
  };
  _videoTimer = setInterval(run, 30 * 1000);
  console.log('[video] cron de animación cada 30s');
}
