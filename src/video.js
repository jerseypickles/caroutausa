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
import { judgeVideoFidelity, overlayHookVideo } from './videoproc.js';
import { bestMotionPreset } from './learning.js';
import { inventMotionPrompt, generateCopy } from './copy.js';
import { MotionPreset } from './models/motionPreset.js';
import { EditProject } from './models/editProject.js';
import { buildJeansEdit } from './videoedit.js';
import { config } from './config.js';

// Presets de movimiento SUTIL (nada de caminar/gestos -> no se ve IA). El movimiento de
// Seedance sale del prompt; entre start y last frame el delta ya es chico, así que pedimos
// micro-movimiento natural y que el short NO cambie.
export const MOTION_PRESETS = {
  'mirror-sway': 'Subtle realistic micro-movement: the person shifts their weight slightly and the fabric of the clothing sways naturally, very gentle handheld phone-camera motion. Photoreal candid fitpic.',
  'breath-fabric': 'Almost still, only a natural breathing motion and the clothing fabric settling softly, with a barely-there handheld camera drift. Photoreal.',
  'slow-push': 'The camera slowly and smoothly pushes in a little closer while the person stays mostly still with a tiny natural weight shift. Photoreal, cinematic but candid.',
  'weight-shift': 'The person shifts their weight from one leg onto the other with a small natural sway, the denim moving slightly with the motion, gentle handheld camera. Photoreal, candid.',
  'slow-zoom-out': 'The camera very slowly and smoothly pulls back a little, revealing slightly more of the fit, while the person stays mostly still. Photoreal, candid fit-check.',
  'fabric-flow': 'Almost still — the focus is the denim and fabric subtly settling and catching the light, with a barely-there hip or hand movement and minimal handheld drift. Photoreal.',
  // movimiento para la toma WALK (única que permite caminar) — denim en movimiento real.
  'walk': 'The person walks at a natural steady pace, the legs moving in a smooth stride and the denim shorts swaying with each step, candid handheld street fit-check. Photoreal.',
};
// Guard base (siempre) + guard de quietud (todas menos walk).
const FIDELITY_GUARD = ' NO morphing. The denim shorts keep the EXACT same shape, wash, rips, hem and length the whole time.';
const STILL_GUARD = ' NO walking, NO big movements.' + FIDELITY_GUARD + ' Hands stay stable and natural.';
const MOTION_GUARD = STILL_GUARD; // compat: el flujo de clip suelto sigue usando el guard de quietud

// Rota los presets de movimiento (variedad + para que el loop aprenda cuál rinde).
const PRESET_KEYS = Object.keys(MOTION_PRESETS);
let _presetIdx = 0;
function nextPreset() { const k = PRESET_KEYS[_presetIdx % PRESET_KEYS.length]; _presetIdx++; return k; }

// Resuelve el prompt de un preset: fijo o INVENTADO (de la DB).
async function getMotionPrompt(tag) {
  if (MOTION_PRESETS[tag]) return MOTION_PRESETS[tag];
  const m = await MotionPreset.findOne({ tag }).lean().catch(() => null);
  return m?.prompt || MOTION_PRESETS['mirror-sway'];
}
// El director INVENTA un movimiento nuevo y lo guarda (para reusar + que aprenda). Devuelve el tag.
async function inventMotion() {
  const inv = await inventMotionPrompt();
  if (!inv?.tag || !inv.prompt) return null;
  await MotionPreset.updateOne({ tag: inv.tag }, { $setOnInsert: { tag: inv.tag, prompt: inv.prompt, invented: true } }, { upsert: true });
  console.log('[video] movimiento inventado:', inv.tag);
  return inv.tag;
}
// EXPLORE/EXPLOIT (ε-greedy): explota el ganador por CTR, o explora — a veces INVENTA un
// movimiento nuevo (descubre), si no round-robin sobre fijos + inventados (cubre todos).
// Devuelve { preset, mode }: mode = 'exploit' (ganador por CTR) | 'explore' (round-robin) |
// 'invent' (movimiento nuevo descubierto). El modo se muestra en la card para ver qué hace.
async function pickVideoPreset() {
  const eps = Number(process.env.VIDEO_EXPLORE || 0.35);
  const best = await bestMotionPreset().catch(() => null);
  if (best && Math.random() > eps) return { preset: best, mode: 'exploit' }; // explotar
  // explorar:
  const inventChance = Number(process.env.VIDEO_INVENT || 0.25);
  const count = await MotionPreset.countDocuments().catch(() => 0);
  if (Math.random() < inventChance && count < 12) {
    const t = await inventMotion().catch(() => null);
    if (t) return { preset: t, mode: 'invent' }; // movimiento NUEVO descubierto
  }
  const invented = await MotionPreset.find().select('tag').lean().catch(() => []);
  const keys = [...PRESET_KEYS, ...invented.map((m) => m.tag)];
  const k = keys[_presetIdx % keys.length]; _presetIdx++;
  return { preset: k, mode: 'explore' };
}

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
// EXPLORACIÓN de composición: variamos setting/ángulo/luz/pose MANTENIENDO el waist-down ->
// el modelo prueba muchas variantes del medio-cuerpo (no el mismo prompt fijo siempre).
const V_SETTING = [
  'a clean minimal bedroom with a soft cream rug and light wood floor',
  'a hallway with light wood floor and a plain wall',
  'against a plain white wall on a concrete floor',
  'a sunlit room next to a big window with sheer curtains',
  'a neutral apartment corner with a sofa edge and wood floor',
  'a tiled bathroom-mirror area, clean and bright',
];
const V_ANGLE = [
  'shot straight-on at hip level',
  'shot from a slightly LOW angle looking up (makes the legs look longer and the shorts bigger)',
  'shot at a slight 3/4 angle to the side',
  'shot straight-on, camera a touch lower than the hips',
];
const V_LIGHT = ['soft window daylight from the side, soft shadows', 'bright even natural daylight', 'warm late-afternoon light', 'soft diffused indoor light'];
const V_POSE = [
  'weight on one leg, the other foot relaxed',
  'feet about shoulder-width, one hand resting near the pocket',
  'a slight turn into a 3/4 stance, weight shifted',
  'casual relaxed stance, toes slightly apart',
];
const rand = (a) => a[Math.floor(Math.random() * a.length)];

// TOMAS por jean (todas WAIST-DOWN). La variedad sale de ángulo + distancia + acción, NO de
// cambiar a cuerpo completo. frame = encuadre específico; motion = preset i2v; last = el siguiente
// momento; allowWalk = la única que permite caminar (las demás se mantienen quietas).
export const SHOT_TYPES = {
  'fit-check': {
    label: 'Fit-check',
    frame: null, // null -> usa la exploración aleatoria de ángulo/pose (la toma héroe actual)
    motion: 'weight-shift',
    last: 'SHIFT the body weight onto the OTHER leg and change the stance slightly — a natural small movement, a different stance.',
    allowWalk: false,
  },
  'detalle': {
    label: 'Detalle',
    frame: 'a TIGHTER, CLOSER crop on the upper part of the shorts: the wash, the front pocket, the button and zip fly, the waistband and the fabric texture FILL the frame, framed from roughly mid-thigh up to the waistband, one hand resting casually near the pocket. Macro fit-check detail.',
    motion: 'slow-push',
    last: 'keep the SAME tight detail framing; the hand near the pocket moves a little and the camera pushes in just slightly closer on the denim detail.',
    allowWalk: false,
  },
  'walk': {
    label: 'Walk',
    frame: 'the legs and denim shorts in mid-WALK toward the camera, captured mid-stride with a natural candid street motion, dynamic fit-check from the waist down.',
    motion: 'walk',
    last: 'the SAME walk continues — the legs take the NEXT step, the opposite leg now forward, the denim shorts swaying with the stride.',
    allowWalk: true,
  },
  'side': {
    label: 'Side/back',
    frame: 'shot from a 3/4 side-back angle showing the BACK POCKET, side seam and the back of the denim shorts, the body turned slightly away with the weight shifted onto one hip.',
    motion: 'weight-shift',
    last: 'the body turns just slightly more, showing the back pocket and side seam from a touch more of an angle; small natural movement.',
    allowWalk: false,
  },
};

function videoStartPrompt(refDna = '', shot = null) {
  const ref = refDna ? ` The sneakers, socks and lower-body styling vibe match the STYLE REFERENCE (last image): ${refDna}.` : '';
  const def = shot && SHOT_TYPES[shot.shotType];
  // Setting + luz: del proyecto (FIJOS para coherencia entre tomas) o aleatorios (clip suelto).
  const setting = shot?.setting || rand(V_SETTING);
  const lighting = shot?.lighting || rand(V_LIGHT);
  // Encuadre: específico de la toma, o exploración aleatoria (fit-check / clip suelto).
  const framing = def && def.frame
    ? def.frame
    : `${rand(V_ANGLE)}; ${rand(V_POSE)}`;
  return `${GARMENT_LOCK}
Vertical mirror-selfie fit-check photo, casual iPhone quality. CROPPED FRAMING FROM THE WAIST DOWN — the head, chest and arms are NOT visible in the frame; show ONLY the very bottom edge of the torso/top, the legs and the feet. The subject wears the denim SHORTS from the FIRST product image EXACTLY: same wash, wide straight leg, knee length, raw frayed released hem, front button and zip fly, pockets. Only the BOTTOM HEM of an oversized top (hoodie or tee) is visible at the very top edge of the frame. Bare lower legs between the shorts hem and white crew socks, current chunky sneakers. ${framing}. Setting: ${setting}. Lighting: ${lighting}. Amateur fit-check aesthetic, slight phone-camera grain, realistic denim fabric texture and wash detail. The denim SHORTS fill the frame and are the whole subject.${ref}
NO head, NO face, NO chest, NO arms, NO text overlay.`;
}
// Last frame: el siguiente momento — según la toma (cambio de stance / paso / push).
function videoLastPrompt(shot = null) {
  const def = shot && SHOT_TYPES[shot.shotType];
  const move = def?.last || 'SHIFT the body weight onto the OTHER leg and change the stance slightly — a natural small movement, visibly a different stance, NOT a frozen copy of the previous frame.';
  return `${GARMENT_LOCK}
The SECOND image is the previous frame of a vertical WAIST-DOWN fit-check clip (cropped from the waist down: no head, chest or arms — only the legs, the denim shorts and the feet). Generate the NEXT moment of the SAME clip: keep the SAME denim shorts, legs, socks, sneakers, floor, room and lighting IDENTICAL and the SAME waist-down framing, but ${move} Casual iPhone fit-check, realistic grain.
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

    // Toma (shot) del flujo por-jean: encuadre + setting/luz FIJOS del proyecto. null -> clip suelto.
    const shot = clip.shotType ? { shotType: clip.shotType, setting: clip.editSetting, lighting: clip.editLighting } : null;

    // SIN director (el casting describía una PERSONA COMPLETA y le ganaba al "waist-down").
    // Prompt DIRECTO de encuadre cintura-abajo, full resolución nativa (sin zoom-crop).
    const start = await generateVariant({
      imageUrl, productDescription, fitSpec, size: STORY_SIZE,
      referenceB64: clip.referenceImageData || null,
      prompt: videoStartPrompt(clip.referenceDna || '', shot),
    });
    // LAST frame: el siguiente momento DESDE el start (según la toma).
    const last = await generateVariant({
      imageUrl, referenceB64: start.b64, productDescription, fitSpec,
      prompt: videoLastPrompt(shot), size: STORY_SIZE,
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
      castTag: 'lower-body', sceneTag: clip.shotType || 'fit-check',
      hookLine: hook?.hookLine || null, callout: hook?.callout || null, fontTag: hook?.fontTag || null,
      stage: 'frames', genStatus: 'ready', error: null,
    });

    // Copy del ad (5 primary texts + 5 headlines, como los singles) -> Meta los A/B-testea.
    try {
      const copy = await generateCopy({ product: clip.product, wash: clip.wash, angle: 'video fit-check', description: productDescription });
      await VideoClip.findByIdAndUpdate(clipId, { copy: { ...copy, edited: false } });
    } catch (e) { console.error('[video] copy:', e.message); }

    // AUTO-GATE: si los dos frames pasan fidelidad, anima solo (no gasta Seedance en frames malos).
    const bothPass = (startFid.score ?? 0) >= 85 && (lastFid.score ?? 0) >= 85;
    if (config.videoAuto && bothPass) {
      // Toma del flujo por-jean -> movimiento FIJO de la toma. Clip suelto -> ε-greedy (explora/explota).
      const { preset, mode } = clip.shotType && SHOT_TYPES[clip.shotType]
        ? { preset: SHOT_TYPES[clip.shotType].motion, mode: 'shot' }
        : await pickVideoPreset();
      animateClip(clipId, { preset, mode }).catch((e) => console.error('[video] auto-animate:', e.message));
    }
  } catch (err) {
    console.error(`[video] frames fallo (${clipId}):`, err.message);
    await VideoClip.findByIdAndUpdate(clipId, { genStatus: 'failed', stage: 'failed', error: err.message });
  }
}

// 2) ANIMAR: manda start+last a Seedance (URLs públicas de nuestros frames).
export async function animateClip(clipId, { preset = 'mirror-sway', mode = 'manual' } = {}) {
  if (!piapiConfigured()) throw new Error('PIAPI_KEY no configurada');
  const clip = await VideoClip.findById(clipId).lean();
  if (!clip) throw new Error('clip no encontrado');
  const base = config.publicBaseUrl.replace(/\/$/, '');
  const startUrl = `${base}/api/video/${clipId}/start-frame`;
  const lastUrl = `${base}/api/video/${clipId}/last-frame`;
  // Toma walk -> guard sin "NO walking"; el resto se mantiene quieto.
  const def = clip.shotType && SHOT_TYPES[clip.shotType];
  const guard = def?.allowWalk ? FIDELITY_GUARD : STILL_GUARD;
  const prompt = (await getMotionPrompt(preset)) + guard;
  const taskId = await createVideoTask({
    imageUrls: [startUrl, lastUrl], prompt, duration: clip.duration || 5,
    aspectRatio: '9:16', resolution: '1080p', fast: false, // seedance-2 (1080p; -fast no soporta 1080p)
  });
  await VideoClip.findByIdAndUpdate(clipId, { taskId, motionPreset: preset, exploreMode: mode, motionPrompt: prompt, stage: 'animating', error: null });
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
  let videoBuf = null;
  try { const res = await fetch(t.videoUrl); if (res.ok) videoBuf = Buffer.from(await res.arrayBuffer()); } catch (e) {}
  if (!videoBuf) { await VideoClip.findByIdAndUpdate(clipId, { videoUrl: t.videoUrl, stage: 'qc' }); return { done: true }; }

  // QC AUTOMÁTICO: muestrea frames del mp4 y verifica que el short se mantuvo fiel todo el clip.
  const prod = clip.shopifyProductId ? await Product.findOne({ shopifyId: clip.shopifyProductId }).lean() : null;
  const fitSpec = prod?.fitSpec || '';
  let qc = { status: 'pending', fidelity: null, notes: '' };
  try {
    const r = await judgeVideoFidelity({ mp4Buffer: videoBuf, duration: clip.duration || 5, sourceImageUrl: clip.sourceImageUrl, fitSpec });
    const pass = (r.score ?? 0) >= config.videoQcMin && (r.morphScore ?? 100) >= 80; // fidelidad + sin morphing
    const note = [r.morphScore != null && r.morphScore < 80 ? `morphing ${r.morphScore}` : '', ...(r.issues || [])].filter(Boolean).join('; ');
    qc = { status: pass ? 'pass' : 'fail', fidelity: r.score, notes: note };
  } catch (e) { qc = { status: 'pending', fidelity: null, notes: 'QC error: ' + e.message }; }

  // Si pasa el QC: HOOK overlay (texto nítido) -> ready. Si no: qc (revisión manual en el tab).
  let finalBuf = videoBuf;
  if (qc.status === 'pass' && clip.hookLine) {
    try { finalBuf = await overlayHookVideo(videoBuf, { hookLine: clip.hookLine, callout: clip.callout || '' }); }
    catch (e) { console.error('[video] hook overlay:', e.message); }
  }
  await VideoClip.findByIdAndUpdate(clipId, {
    videoUrl: t.videoUrl, videoData: finalBuf.toString('base64'),
    videoQc: qc, stage: qc.status === 'pass' ? 'ready' : 'qc',
  });
  return { done: true, qc: qc.status, fidelity: qc.fidelity };
}

// Cron liviano: avanza las tasks en 'animating' (poll Seedance -> baja mp4 -> QC -> ready/qc).
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

// AUTOPILOT de video: cada N min crea UN clip nuevo del producto con menos videos (rota),
// con un cap de en-vuelo para no saturar RAM/Seedance. Frames -> auto-gate -> animar -> QC -> ready.
let _vauTimer = null;
export function startVideoAutopilot() {
  if (_vauTimer || !piapiConfigured() || !config.videoAuto) return;
  const everyMin = Number(process.env.VIDEO_AUTOPILOT_MIN || 240); // ~6 veces/día (cada 4h)
  const run = async () => {
    try {
      const inflight = await VideoClip.countDocuments({ stage: { $in: ['frames', 'animating'] } });
      if (inflight >= 2) return; // no saturar (OOM + créditos)
      const prods = await Product.find().select('shopifyId title wash image').lean();
      if (!prods.length) return;
      const counts = await Promise.all(prods.map(async (p) => ({ p, n: await VideoClip.countDocuments({ shopifyProductId: p.shopifyId }) })));
      counts.sort((a, b) => a.n - b.n); // el producto con menos clips de video
      const product = counts[0].p;
      const [ref] = await pickRefs({ shopifyProductId: product.shopifyId, wash: product.wash, n: 1, type: 'outfit' });
      const clip = await VideoClip.create({
        shopifyProductId: product.shopifyId, product: product.title, wash: product.wash, sourceImageUrl: product.image,
        referenceId: ref?.id || null, referenceDna: ref?.dna || '', referenceImageData: ref?.b64 || null,
        stage: 'frames', genStatus: 'generating',
      });
      generateVideoFrames(clip._id).catch((e) => console.error('[video] autopilot frames:', e.message));
      console.log('[video] autopilot: nuevo clip de', product.title);
    } catch (e) { console.error('[video] autopilot:', e.message); }
  };
  // NO corremos al arranque (cada deploy/restart dispararía un clip). Solo en el intervalo.
  _vauTimer = setInterval(run, everyMin * 60 * 1000);
  console.log(`[video] autopilot cada ${everyMin}min (sin run al arranque)`);
}

// ============ FLUJO POR-JEAN (EditProject) ============

// Crea un EditProject: 1 jean + N tomas (shots) del MISMO jean, setting/luz FIJOS (cohesión).
// Genera los frames de cada toma en SECUENCIA (no satura RAM/Seedance); el auto-gate las anima.
export async function createEditProject({ shopifyProductId, shotTypes } = {}) {
  const product = shopifyProductId
    ? await Product.findOne({ shopifyId: Number(shopifyProductId) }).lean()
    : await Product.findOne().sort({ generatedCount: 1 }).lean();
  if (!product) throw new Error('Producto no encontrado');
  const [ref] = await pickRefs({ shopifyProductId: product.shopifyId, wash: product.wash, n: 1, type: 'outfit' });
  const types = (shotTypes && shotTypes.length ? shotTypes : ['fit-check', 'detalle', 'walk', 'side']).filter((t) => SHOT_TYPES[t]);
  // setting + luz FIJOS del proyecto -> todas las tomas comparten -> el edit se ve como UNA pieza.
  const setting = rand(V_SETTING);
  const lighting = rand(V_LIGHT);

  const project = await EditProject.create({
    shopifyProductId: product.shopifyId, product: product.title, wash: product.wash, sourceImageUrl: product.image,
    referenceId: ref?.id || null, referenceDna: ref?.dna || '',
    setting, lighting, shotTypes: types, stage: 'shots',
  });

  // crea una toma (VideoClip) por shotType
  const shotIds = [];
  for (const t of types) {
    const clip = await VideoClip.create({
      shopifyProductId: product.shopifyId, product: product.title, wash: product.wash, sourceImageUrl: product.image,
      referenceId: ref?.id || null, referenceDna: ref?.dna || '', referenceImageData: ref?.b64 || null,
      editProjectId: project._id, shotType: t, editSetting: setting, editLighting: lighting,
      stage: 'frames', genStatus: 'generating',
    });
    shotIds.push(clip._id);
  }
  await EditProject.findByIdAndUpdate(project._id, { shotIds });

  // genera los frames en SECUENCIA en background (cada uno se auto-anima si pasa fidelidad)
  (async () => {
    for (const id of shotIds) {
      await generateVideoFrames(id).catch((e) => console.error('[edit] shot frames:', e.message));
    }
  })();

  return { id: project._id, shots: shotIds.length, product: product.title };
}

// Arma el EDIT del proyecto a partir de sus tomas LISTAS (mismo jean) -> reel de retención.
// CTA del ad = ese producto. v1: beat sintetizado (la música real la sube el usuario -> próximo).
export async function buildProjectEdit(projectId, { bpm } = {}) {
  const project = await EditProject.findById(projectId).lean();
  if (!project) throw new Error('proyecto no encontrado');
  const shots = await VideoClip.find({ _id: { $in: project.shotIds }, stage: 'ready' })
    .select('+videoData videoUrl shotType').lean();
  if (shots.length < 2) throw new Error('necesito al menos 2 tomas listas');
  // ordena por el orden de shotTypes del proyecto (fit-check, detalle, walk, side)
  const order = project.shotTypes;
  shots.sort((a, b) => order.indexOf(a.shotType) - order.indexOf(b.shotType));

  await EditProject.findByIdAndUpdate(projectId, { stage: 'editing', error: null });
  try {
    // fuente CRUDA (sin hook bakeado): videoUrl de Seedance; fallback a nuestra copia.
    const clips = [];
    for (const s of shots) {
      let buffer = null;
      if (s.videoUrl) { try { const r = await fetch(s.videoUrl); if (r.ok) buffer = Buffer.from(await r.arrayBuffer()); } catch {} }
      if (!buffer && s.videoData) buffer = Buffer.from(s.videoData, 'base64');
      if (buffer) clips.push({ buffer, wash: s.shotType });
    }
    if (clips.length < 2) throw new Error('no pude bajar las tomas crudas');

    const hookLine = project.hookLine || 'THE ONLY SHORTS YOU NEED';
    const callout = project.callout || `${project.wash || ''} WASH · CAROTA`.trim();
    const r = await buildJeansEdit({ clips, hookLine, callout, bpm: Number(bpm) || 100, targetSec: 11 });
    const b64 = r.buffer.toString('base64');
    if (b64.length > 15.5 * 1024 * 1024) throw new Error(`edit muy pesado (${(r.buffer.length / 1e6).toFixed(1)}MB)`);

    // copy del ad (como los singles) para Meta
    let copy = {};
    try { copy = await generateCopy({ product: project.product, wash: project.wash, angle: 'video edit', description: project.product }); } catch {}

    await EditProject.findByIdAndUpdate(projectId, {
      editVideoData: b64, editDuration: r.duration, stage: 'ready',
      hookLine, callout, ...(copy.primaryTexts ? { copy: { ...copy, edited: false } } : {}),
    });
    console.log(`[edit] proyecto ${projectId} listo: ${r.segments} cortes, ${r.duration}s`);
    return { ok: true, duration: r.duration, segments: r.segments };
  } catch (e) {
    await EditProject.findByIdAndUpdate(projectId, { stage: 'failed', error: e.message });
    throw e;
  }
}
