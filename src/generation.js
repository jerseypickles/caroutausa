import { Creative } from './models/creative.js';
import { generateVariant } from './openai.js';
import { judgeFidelity } from './judge.js';
import { generateCopy } from './copy.js';
import { config } from './config.js';

// Genera en background y actualiza el doc cuando termina. Tras la imagen corre el
// juez de fidelidad; si marca fail y quedan reintentos, regenera in-place (la
// referencia tiene varianza alta, un re-roll suele caer mejor).
export async function generateInBackground(creativeId, imageUrl, angleId, referenceB64, productDescription, attempt = 0) {
  let b64;
  try {
    ({ b64 } = await generateVariant({ imageUrl, angleId, referenceB64, productDescription }));
    await Creative.findByIdAndUpdate(creativeId, { imageData: b64, genStatus: 'ready', genError: null });
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
    const v = await judgeFidelity({ sourceImageUrl: imageUrl, b64 });
    await Creative.findByIdAndUpdate(creativeId, {
      fidelityStatus: 'done', fidelityScore: v.score, fidelityVerdict: v.verdict,
      fidelityIssues: v.issues, fidelitySummary: v.summary, fidelityError: null, retries: attempt,
    });

    // Auto-regenerar si no paso la fidelidad y quedan reintentos.
    if (v.verdict !== 'pass' && attempt < config.fidelityRetries) {
      console.log(`[gen] fidelidad ${v.score} < umbral, regenerando (intento ${attempt + 1}) ${creativeId}`);
      await Creative.findByIdAndUpdate(creativeId, { genStatus: 'generating', fidelityStatus: 'pending' });
      return generateInBackground(creativeId, imageUrl, angleId, referenceB64, productDescription, attempt + 1);
    }
  } catch (err) {
    console.error(`[gen] juez fallo (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { fidelityStatus: 'failed', fidelityError: err.message });
  }
}

// Crea y dispara N jobs explicitos. jobs: [{ angleId, ref: {b64}|null }].
export async function enqueueJobs({ imageUrl, jobs, meta = {}, productDescription = '' }) {
  const created = await Creative.create(
    jobs.map(({ angleId, ref }) => ({
      ...meta,
      angle: angleId,
      sourceImageUrl: imageUrl,
      qcStatus: 'generated',
      genStatus: 'generating',
      hasReference: Boolean(ref),
      referenceImageData: ref?.b64 || null,
    }))
  );
  created.forEach((doc, i) => generateInBackground(doc._id, imageUrl, doc.angle, jobs[i].ref?.b64 || null, productDescription));
  return created;
}

// Wrapper: producto cartesiano angles × references (para el endpoint manual).
export async function enqueueGeneration({ imageUrl, angles, references = [], meta = {}, productDescription = '' }) {
  const refs = references.length ? references : [null];
  const jobs = [];
  for (const angleId of angles) for (const ref of refs) jobs.push({ angleId, ref });
  return enqueueJobs({ imageUrl, jobs, meta, productDescription });
}
