import { Creative } from './models/creative.js';
import { generateVariant, STORY_SIZE, FEED_SIZE } from './openai.js';
import { buildFeedReframePrompt } from './angles.js';
import { judgeFidelity } from './judge.js';
import { generateCopy } from './copy.js';
import { directCreative } from './director.js';
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
    const creativeDirection = await directCreative({
      product: doc?.product, wash: doc?.wash, angle: angleId,
      withReference: Boolean(referenceB64), styleMode,
      seed: attempt > 0 ? `retry ${attempt}: try a completely different setting and energy` : '',
    });
    // 9:16 (story/reels) = placement principal
    ({ b64 } = await generateVariant({ imageUrl, angleId, referenceB64, productDescription, creativeDirection, fitSpec, styleMode, size: STORY_SIZE }));
    // 4:5 (feed) = la MISMA foto reframed (usa el 9:16 como referencia)
    let feedB64 = null;
    try {
      const feed = await generateVariant({ imageUrl, referenceB64: b64, productDescription, fitSpec, styleMode, prompt: buildFeedReframePrompt(productDescription), size: FEED_SIZE });
      feedB64 = feed.b64;
    } catch (e) { console.error(`[gen] feed 4:5 fallo (${creativeId}):`, e.message); }
    await Creative.findByIdAndUpdate(creativeId, { imageData: b64, feedImageData: feedB64, genStatus: 'ready', genError: null });
  } catch (err) {
    console.error(`[gen] fallo angulo ${angleId} (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { genStatus: 'failed', genError: err.message, fidelityStatus: 'failed' });
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
