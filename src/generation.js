import { Creative } from './models/creative.js';
import { generateVariant, STORY_SIZE, FEED_SIZE, SQUARE_SIZE } from './openai.js';
import { buildFeedReframePrompt, buildSquareReframePrompt, buildFlatlayPrompt } from './angles.js';
import { judgeFidelity } from './judge.js';
import { generateCopy } from './copy.js';
import { directCreative } from './director.js';
import { pickScene, pickPose } from './refs.js';
import { planHook } from './hook.js';
import { logActivity } from './models/activity.js';
import { config } from './config.js';

// Genera en background y actualiza el doc cuando termina. Tras la imagen corre el
// juez de fidelidad; si marca fail y quedan reintentos, regenera in-place (la
// referencia tiene varianza alta, un re-roll suele caer mejor).
export async function generateInBackground(creativeId, imageUrl, angleId, referenceB64, productDescription, attempt = 0, fitSpec = '') {
  let b64;
  try {
    // El director (Claude) inventa la direccion creativa de este fitpic. Si no hay
    // key o falla, generateVariant cae al prompt fijo del angulo. En reintentos se
    // re-dirige (nueva escena) para aprovechar la varianza.
    const doc = await Creative.findById(creativeId).lean();
    const styleMode = doc?.styleMode || 'organic';
    // La referencia es INSPIRACION (ADN de estilo), no un clon: el director arma un
    // outfit fresco en ese lane. NO mandamos la imagen de referencia a gpt-image.
    // Si hay referencias de ESCENA, una maneja la locacion (si no, rota la lista fija).
    const scene = await pickScene(doc?.shopifyProductId).catch(() => null);
    const pose = await pickPose(doc?.shopifyProductId).catch(() => null);
    const dir = await directCreative({
      product: doc?.product, wash: doc?.wash, angle: angleId,
      refDna: doc?.referenceDna || '', sceneDna: scene?.dna || '', poseDna: pose?.dna || '', styleMode,
      seed: attempt > 0 ? `retry ${attempt}: try a completely different setting and energy` : '',
    });
    const creativeDirection = dir?.text || '';
    // HOOK dirigido: se decide ACÁ (texto + fuente rotada/explorada) y se BAKEA en la misma
    // generación (una sola pasada, sin perder contexto). La fidelidad la cubre el judge.
    let hookSpec = null;
    if (config.hookAuto) {
      try { hookSpec = await planHook({ product: doc?.product, wash: doc?.wash, fitSpec: doc?.fitSpec || '' }); } catch (e) { console.error(`[gen] planHook (${creativeId}):`, e.message); }
    }
    // ADN del creativo (para aprender qué rinde): escena + casting + fuente del hook.
    await Creative.findByIdAndUpdate(creativeId, { sceneTag: dir?.sceneTag, castTag: dir?.castTag, hookLine: hookSpec?.hookLine || null, fontTag: hookSpec?.fontTag || null });
    // 9:16 (story/reels) = placement principal, con el hook bakeado. La 2da foto (espalda)
    // habilita tomas de movimiento/espalda fieles.
    ({ b64 } = await generateVariant({ imageUrl, productBackUrl: doc?.sourceBackUrl || '', angleId, productDescription, creativeDirection, fitSpec, styleMode, size: STORY_SIZE, hookSpec }));
    // 4:5 (feed) y 1:1 (square) = la MISMA foto reframed, con el hook RE-UBICADO por aspecto.
    let feedB64 = null;
    try {
      const feed = await generateVariant({ imageUrl, referenceB64: b64, productDescription, fitSpec, styleMode, prompt: buildFeedReframePrompt(productDescription, hookSpec), size: FEED_SIZE });
      feedB64 = feed.b64;
    } catch (e) { console.error(`[gen] feed 4:5 fallo (${creativeId}):`, e.message); }
    let squareB64 = null;
    try {
      const sq = await generateVariant({ imageUrl, referenceB64: b64, productDescription, fitSpec, styleMode, prompt: buildSquareReframePrompt(productDescription, hookSpec), size: SQUARE_SIZE });
      squareB64 = sq.b64;
    } catch (e) { console.error(`[gen] square 1:1 fallo (${creativeId}):`, e.message); }
    await Creative.findByIdAndUpdate(creativeId, { imageData: b64, feedImageData: feedB64, squareImageData: squareB64, genStatus: 'ready', genError: null });
    const d = await Creative.findById(creativeId).select('product').lean();
    logActivity('single', `Single listo (${angleId}${hookSpec ? ' · hook ' + hookSpec.fontTag : ''}) de ${d?.product || ''}`, { product: d?.product || '', refId: String(creativeId), level: 'ok' });
  } catch (err) {
    console.error(`[gen] fallo angulo ${angleId} (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { genStatus: 'failed', genError: err.message, fidelityStatus: 'failed' });
    logActivity('error', `Single fallo (${angleId}): ${err.message}`, { level: 'error' });
    return;
  }

  // Copy nativo del ad (solo en el primer intento, no pisa ediciones del humano).
  if (attempt === 0) {
    try {
      const doc = await Creative.findById(creativeId).lean();
      if (!doc?.copy?.edited) {
        const copy = await generateCopy({ product: doc.product, wash: doc.wash, angle: angleId, description: productDescription });
        await Creative.findByIdAndUpdate(creativeId, { copy: { ...copy, edited: false } });
      }
    } catch (err) { console.error(`[gen] copy fallo (${creativeId}):`, err.message); }
  }

  try {
    const v = await judgeFidelity({ sourceImageUrl: imageUrl, b64, fitSpec });
    await Creative.findByIdAndUpdate(creativeId, {
      fidelityStatus: 'done', fidelityScore: v.score, fidelityVerdict: v.verdict,
      fidelityIssues: v.issues, fidelitySummary: v.summary, fidelityError: null, retries: attempt,
      fitScore: v.fitScore, fitIssues: v.fitIssues,
    });

    // Auto-regenerar si no paso la fidelidad y quedan reintentos.
    if (v.verdict !== 'pass' && attempt < config.fidelityRetries) {
      console.log(`[gen] fidelidad ${v.score} < umbral, regenerando (intento ${attempt + 1}) ${creativeId}`);
      await Creative.findByIdAndUpdate(creativeId, { genStatus: 'generating', fidelityStatus: 'pending' });
      return generateInBackground(creativeId, imageUrl, angleId, referenceB64, productDescription, attempt + 1, fitSpec);
    }
  } catch (err) {
    console.error(`[gen] juez fallo (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { fidelityStatus: 'failed', fidelityError: err.message });
  }
}

// Flat-lay / packshot: genera el short SOLO como still-life (sin modelo, sin ref).
export async function generateFlatlayInBackground(creativeId, imageUrl, productDescription = '', fitSpec = '') {
  let b64;
  try {
    ({ b64 } = await generateVariant({ imageUrl, productDescription, prompt: buildFlatlayPrompt(productDescription, fitSpec), size: FEED_SIZE }));
    await Creative.findByIdAndUpdate(creativeId, { imageData: b64, feedImageData: b64, genStatus: 'ready', genError: null });
    const d = await Creative.findById(creativeId).select('product').lean();
    logActivity('flatlay', `Packshot listo de ${d?.product || ''}`, { product: d?.product || '', refId: String(creativeId), level: 'ok' });
  } catch (err) {
    console.error(`[flatlay] fallo (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { genStatus: 'failed', genError: err.message, fidelityStatus: 'failed' });
    logActivity('error', `Packshot fallo: ${err.message}`, { level: 'error' });
    return;
  }
  try {
    const doc = await Creative.findById(creativeId).lean();
    if (!doc?.copy?.edited) {
      const copy = await generateCopy({ product: doc.product, wash: doc.wash, angle: 'flatlay', description: productDescription });
      await Creative.findByIdAndUpdate(creativeId, { copy: { ...copy, edited: false } });
    }
  } catch (err) { console.error(`[flatlay] copy fallo (${creativeId}):`, err.message); }
  try {
    const v = await judgeFidelity({ sourceImageUrl: imageUrl, b64, fitSpec });
    await Creative.findByIdAndUpdate(creativeId, {
      fidelityStatus: 'done', fidelityScore: v.score, fidelityVerdict: v.verdict,
      fidelityIssues: v.issues, fidelitySummary: v.summary, fitScore: v.fitScore, fitIssues: v.fitIssues,
    });
  } catch (err) { console.error(`[flatlay] juez fallo (${creativeId}):`, err.message); }
}

// Encola un flat-lay para un producto.
export async function enqueueFlatlay({ imageUrl, meta = {}, productDescription = '', fitSpec = '' }) {
  const doc = await Creative.create({
    ...meta, angle: 'flatlay', format: 'flatlay', styleMode: 'organic',
    sourceImageUrl: imageUrl, qcStatus: 'generated', genStatus: 'generating', hasReference: false,
  });
  generateFlatlayInBackground(doc._id, imageUrl, productDescription, fitSpec).catch((e) => console.error('[flatlay] job:', e.message));
  return doc;
}

// Crea y dispara N jobs explicitos. jobs: [{ angleId, ref: {b64}|null }].
export async function enqueueJobs({ imageUrl, jobs, meta = {}, productDescription = '', fitSpec = '' }) {
  const created = await Creative.create(
    jobs.map(({ angleId, ref, styleMode = 'organic' }) => ({
      ...meta,
      angle: angleId,
      styleMode,
      sourceImageUrl: imageUrl,
      qcStatus: 'generated',
      genStatus: 'generating',
      hasReference: Boolean(ref),
      referenceId: ref?.id || null,
      referenceDna: ref?.dna || '',
      referenceImageData: ref?.b64 || null,
    }))
  );
  // Secuencial (no en paralelo): el plan starter tiene poca RAM y 2+ generaciones
  // simultaneas la saturan y reinician el server (mata los jobs). Una a la vez.
  (async () => {
    for (let i = 0; i < created.length; i++) {
      try {
        await generateInBackground(created[i]._id, imageUrl, created[i].angle, jobs[i].ref?.b64 || null, productDescription, 0, fitSpec);
      } catch (e) { console.error('[gen] job fallo:', e.message); }
    }
  })();
  return created;
}

// Wrapper: producto cartesiano angles × references (para el endpoint manual).
export async function enqueueGeneration({ imageUrl, angles, references = [], meta = {}, productDescription = '', fitSpec = '' }) {
  const refs = references.length ? references : [null];
  const jobs = [];
  for (const angleId of angles) for (const ref of refs) jobs.push({ angleId, ref });
  return enqueueJobs({ imageUrl, jobs, meta, productDescription, fitSpec });
}
