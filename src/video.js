import sharp from 'sharp';
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

// CROP cerrado DETERMINÍSTICO: gpt-image no respeta el encuadre por texto, así que recorto yo.
// Corta la cabeza arriba y hace zoom (bottom-aligned, mantiene los pies) -> el PRODUCTO llena
// el frame, como un fit-check pegado al espejo (sin cara). Mismo crop a start y last.
const VIDEO_ZOOM = Number(process.env.VIDEO_ZOOM || 1);
async function tightCrop(b64, zoom = VIDEO_ZOOM) {
  if (!zoom || zoom <= 1.01) return b64; // sin crop -> sin upscale (el encuadre es nativo)
  const buf = Buffer.from(b64, 'base64');
  const m = await sharp(buf).metadata();
  const W = m.width, H = m.height;
  const cw = Math.round(W / zoom), ch = Math.round(H / zoom);
  const left = Math.round((W - cw) / 2);
  const top = H - ch; // pies abajo, cabeza cortada arriba
  const out = await sharp(buf).extract({ left, top, width: cw, height: ch }).resize(W, H).webp({ quality: 92 }).toBuffer();
  return out.toString('base64');
}

// Prompt DIRECTO waist-down (SIN director/casting -> no genera persona completa). Modelado
// en el prompt que probó el usuario: describe el ENCUADRE de la cintura para abajo + el short.
function videoStartPrompt(refDna = '') {
  const ref = refDna ? ` The sneakers, socks and lower-body styling vibe match the STYLE REFERENCE (last image): ${refDna}.` : '';
  return `${GARMENT_LOCK}
Vertical mirror-selfie fit-check photo, casual iPhone quality. CROPPED FRAMING FROM THE WAIST DOWN — the head, chest and arms are NOT visible in the frame; show ONLY the very bottom edge of the torso/top, the legs and the feet. The subject wears the denim SHORTS from the FIRST product image EXACTLY: same wash, wide straight leg, knee length, raw frayed released hem, front button and zip fly, pockets. Only the BOTTOM HEM of an oversized top (hoodie or tee) is visible at the very top edge of the frame. Bare lower legs between the shorts hem and white crew socks, current chunky sneakers, standing on a soft rug / light wood floor in a clean minimal room. Natural window daylight from the side, soft shadows, amateur fit-check aesthetic, slight phone-camera grain, realistic denim fabric texture and wash detail. The denim SHORTS fill the frame and are the whole subject.${ref}
NO head, NO face, NO chest, NO arms, NO text overlay.`;
}
// Last frame: el siguiente momento (cambio de stance de piernas) — interpola movimiento.
function videoLastPrompt() {
  return `${GARMENT_LOCK}
The SECOND image is the previous frame of a vertical WAIST-DOWN fit-check clip (cropped from the waist down: no head, chest or arms — only the legs, the denim shorts and the feet). Generate the NEXT moment of the SAME clip: keep the SAME denim shorts, legs, socks, sneakers, floor, room and lighting IDENTICAL and the SAME waist-down framing, but SHIFT the body weight onto the OTHER leg and change the stance slightly — a natural small movement, visibly a different stance, NOT a frozen copy of the previous frame. Casual iPhone fit-check, realistic grain.
NO head, NO face, NO chest, NO arms, NO text overlay.`;
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

    // SIN director (el casting describía una PERSONA COMPLETA y le ganaba al "waist-down").
    // Prompt DIRECTO de encuadre cintura-abajo, full resolución nativa (sin zoom-crop).
    const start = await generateVariant({
      imageUrl, productDescription, fitSpec, size: STORY_SIZE,
      referenceB64: clip.referenceImageData || null,
      prompt: videoStartPrompt(clip.referenceDna || ''),
    });
    // LAST frame: el siguiente momento DESDE el start (cambio de stance de piernas).
    const last = await generateVariant({
      imageUrl, referenceB64: start.b64, productDescription, fitSpec,
      prompt: videoLastPrompt(), size: STORY_SIZE,
    });
    const startFid = await judgeFidelity({ sourceImageUrl: imageUrl, b64: start.b64, fitSpec }).catch(() => ({ score: null, issues: [] }));
    const lastFid = await judgeFidelity({ sourceImageUrl: imageUrl, b64: last.b64, fitSpec }).catch(() => ({ score: null, issues: [] }));

    // Hook: lo PLANEAMOS (texto+fuente) pero NO lo bakeamos -> va como overlay al final.
    let hook = null;
    try { hook = await planHook({ product: clip.product, wash: clip.wash, fitSpec }); } catch (e) {}

    await VideoClip.findByIdAndUpdate(clipId, {
      startImageData: start.b64, lastImageData: last.b64,
      startFidelity: startFid.score, lastFidelity: lastFid.score,
      fidelityIssues: [...(startFid.issues || []), ...(lastFid.issues || [])].slice(0, 6),
      castTag: 'lower-body', sceneTag: 'fit-check',
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
    aspectRatio: '9:16', resolution: '1080p', fast: false, // seedance-2 (1080p; -fast no soporta 1080p)
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
