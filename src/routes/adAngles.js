import { Router } from 'express';
import { enqueueGeneration } from '../generation.js';
import { ANGLES, DEFAULT_ANGLE } from '../angles.js';

export const adAnglesRouter = Router();

// POST /api/ad-angles  (generacion manual / one-off)
// body: { imageUrl, angles?: string[], drop?, wash?, product?, hook?, referenceImageB64? }
// Crea Creative(s) genStatus="generating", responde 202 y genera en background.
adAnglesRouter.post('/ad-angles', async (req, res) => {
  const { imageUrl, angles, drop, wash, product, hook, referenceImageB64 } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'Falta imageUrl' });

  const requested = Array.isArray(angles) && angles.length ? angles : [DEFAULT_ANGLE];
  const invalid = requested.filter((a) => !ANGLES[a]);
  if (invalid.length) {
    return res.status(400).json({ error: `Angulos invalidos: ${invalid.join(', ')}`, validos: Object.keys(ANGLES) });
  }

  const referenceB64 = typeof referenceImageB64 === 'string' && referenceImageB64.length ? referenceImageB64 : null;
  const created = await enqueueGeneration({
    imageUrl,
    angles: requested,
    references: referenceB64 ? [{ b64: referenceB64 }] : [],
    meta: { drop, product, wash, hook },
  });

  res.status(202).json({ queued: created.map((d) => ({ id: d._id, angle: d.angle, genStatus: 'generating' })) });
});
