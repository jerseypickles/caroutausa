import { Creative } from './models/creative.js';
import { generateVariant } from './openai.js';
import { judgeFidelity } from './judge.js';

// Genera en background y actualiza el doc cuando termina. Fire-and-forget:
// gpt-image-2 tarda ~2 min, no bloqueamos el request HTTP. Tras la imagen,
// corre el juez de fidelidad del jean.
export async function generateInBackground(creativeId, imageUrl, angleId, referenceB64) {
  let b64;
  try {
    ({ b64 } = await generateVariant({ imageUrl, angleId, referenceB64 }));
    await Creative.findByIdAndUpdate(creativeId, { imageData: b64, genStatus: 'ready', genError: null });
  } catch (err) {
    console.error(`[gen] fallo angulo ${angleId} (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { genStatus: 'failed', genError: err.message, fidelityStatus: 'failed' });
    return;
  }
  try {
    const v = await judgeFidelity({ sourceImageUrl: imageUrl, b64 });
    await Creative.findByIdAndUpdate(creativeId, {
      fidelityStatus: 'done', fidelityScore: v.score, fidelityVerdict: v.verdict,
      fidelityIssues: v.issues, fidelitySummary: v.summary, fidelityError: null,
    });
  } catch (err) {
    console.error(`[gen] juez fallo (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, { fidelityStatus: 'failed', fidelityError: err.message });
  }
}

// Crea N creatives = angles × references (o angles solos si no hay refs) y los
// dispara en background. Devuelve los docs creados.
export async function enqueueGeneration({ imageUrl, angles, references = [], meta = {} }) {
  const refs = references.length ? references : [null];
  const combos = [];
  for (const angleId of angles) for (const ref of refs) combos.push({ angleId, ref });

  const created = await Creative.create(
    combos.map(({ angleId, ref }) => ({
      ...meta,
      angle: angleId,
      sourceImageUrl: imageUrl,
      qcStatus: 'generated',
      genStatus: 'generating',
      hasReference: Boolean(ref),
      referenceImageData: ref?.b64 || null,
    }))
  );

  created.forEach((doc, i) => generateInBackground(doc._id, imageUrl, doc.angle, combos[i].ref?.b64 || null));
  return created;
}
