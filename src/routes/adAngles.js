import { Router } from 'express';
import { Creative } from '../models/creative.js';
import { generateVariant } from '../openai.js';
import { ANGLES, DEFAULT_ANGLE } from '../angles.js';

export const adAnglesRouter = Router();

// POST /api/ad-angles
// body: { imageUrl, angles?: string[], drop?, wash?, product?, hook? }
// Genera variantes (1 por angulo, EN PARALELO), guarda Creative(s)
// qcStatus="generated" con el preview en imageData, y devuelve metadata + b64.
// Maneja fallo parcial: si un angulo falla, los demas siguen.
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

  // gpt-image-2 tarda ~2 min por imagen -> generamos todos los angulos en paralelo.
  const settled = await Promise.allSettled(
    requested.map(async (angleId) => {
      const { b64 } = await generateVariant({ imageUrl, angleId });
      const creative = await Creative.create({
        drop,
        product,
        wash,
        angle: angleId,
        hook,
        sourceImageUrl: imageUrl,
        qcStatus: 'generated',
        imageData: b64,
      });
      return { id: creative._id, angle: angleId, b64 };
    })
  );

  const results = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      results.push(s.value);
    } else {
      console.error(`[ad-angles] fallo angulo ${requested[i]}:`, s.reason?.message);
      errors.push({ angle: requested[i], error: s.reason?.message || 'error' });
    }
  });

  if (!results.length) {
    return res.status(502).json({ error: 'No se genero ninguna variante', errors });
  }
  return res.status(200).json({ results, errors });
});
