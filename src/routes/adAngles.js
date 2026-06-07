import { Router } from 'express';
import { Creative } from '../models/creative.js';
import { generateVariant } from '../openai.js';
import { ANGLES, DEFAULT_ANGLE } from '../angles.js';

export const adAnglesRouter = Router();

// Genera en background y actualiza el doc cuando termina. Fire-and-forget:
// gpt-image-2 tarda ~2 min, no bloqueamos el request HTTP.
async function generateInBackground(creativeId, imageUrl, angleId) {
  try {
    const { b64 } = await generateVariant({ imageUrl, angleId });
    await Creative.findByIdAndUpdate(creativeId, {
      imageData: b64,
      genStatus: 'ready',
      genError: null,
    });
  } catch (err) {
    console.error(`[ad-angles] fallo angulo ${angleId} (${creativeId}):`, err.message);
    await Creative.findByIdAndUpdate(creativeId, {
      genStatus: 'failed',
      genError: err.message,
    });
  }
}

// POST /api/ad-angles
// body: { imageUrl, angles?: string[], drop?, wash?, product?, hook? }
// Crea los Creative(s) como genStatus="generating", responde AL INSTANTE con sus
// ids, y dispara la generacion en background. El panel hace polling de /creatives.
adAnglesRouter.post('/ad-angles', async (req, res) => {
  const { imageUrl, angles, drop, wash, product, hook } = req.body || {};

  if (!imageUrl) {
    return res.status(400).json({ error: 'Falta imageUrl' });
  }

  const requested = Array.isArray(angles) && angles.length ? angles : [DEFAULT_ANGLE];
  const invalid = requested.filter((a) => !ANGLES[a]);
  if (invalid.length) {
    return res.status(400).json({
      error: `Angulos invalidos: ${invalid.join(', ')}`,
      validos: Object.keys(ANGLES),
    });
  }

  // Crea un doc por angulo en estado "generating".
  const created = await Creative.create(
    requested.map((angleId) => ({
      drop, product, wash, angle: angleId, hook,
      sourceImageUrl: imageUrl,
      qcStatus: 'generated',
      genStatus: 'generating',
    }))
  );

  // Dispara la generacion sin esperar (cada una se autoactualiza al terminar).
  created.forEach((doc) => {
    generateInBackground(doc._id, imageUrl, doc.angle);
  });

  // 202 Accepted: trabajo encolado.
  res.status(202).json({
    queued: created.map((d) => ({ id: d._id, angle: d.angle, genStatus: 'generating' })),
  });
});
