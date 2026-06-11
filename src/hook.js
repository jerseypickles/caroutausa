import sharp from 'sharp';
import { Creative } from './models/creative.js';
import { generateHook } from './copy.js';
import { addHookOverlay, STORY_SIZE, SQUARE_SIZE } from './openai.js';
import { judgeHookFidelity } from './judge.js';

// Genera la VARIANTE CON HOOK de un creativo: un hook de beneficio + callout del short,
// aplicado a la 9:16 (story) Y a la 1:1 (square). Guarda hookImageData/hookSquareImageData.
export async function generateHookForCreative(creativeId) {
  const c = await Creative.findById(creativeId).select('+imageData +squareImageData +feedImageData product wash').lean();
  if (!c?.imageData) throw new Error('Creativo sin imagen base');

  const { hook, fit } = await generateHook({ product: c.product, wash: c.wash });
  const washTxt = (c.wash || '').replace(/\s*wash\s*/i, '').toUpperCase().trim();
  const callout = `${washTxt ? washTxt + ' WASH · ' : ''}${fit}`;

  // 9:16 story (siempre)
  const storyPng = await sharp(Buffer.from(c.imageData, 'base64')).png().toBuffer();
  const hookStory = await addHookOverlay(storyPng, { hook, callout, size: STORY_SIZE });

  // 1:1 square (si existe)
  let hookSquare = null;
  const sq = c.squareImageData || c.feedImageData;
  if (sq) {
    const sqPng = await sharp(Buffer.from(sq, 'base64')).png().toBuffer();
    hookSquare = await addHookOverlay(sqPng, { hook, callout, size: SQUARE_SIZE });
  }

  // CHEQUEO DE FIDELIDAD: el pase del hook NO debe tocar el short. Comparamos limpia vs
  // hook (ignorando el texto). Si cambió, descartamos el hook y queda la foto limpia.
  const checkStory = await judgeHookFidelity(c.imageData, hookStory);
  const checkSq = (hookSquare && sq) ? await judgeHookFidelity(sq, hookSquare) : { same: true, note: '' };
  if (!checkStory.same || !checkSq.same) {
    await Creative.findByIdAndUpdate(creativeId, { hookImageData: null, hookSquareImageData: null, hookLine: null });
    return { hook, discarded: true, reason: [checkStory.note, checkSq.note].filter(Boolean).join(' / ') || 'el hook alteró el short' };
  }

  await Creative.findByIdAndUpdate(creativeId, {
    hookImageData: hookStory,
    hookSquareImageData: hookSquare,
    hookLine: hook,
  });
  return { hook, callout, square: Boolean(hookSquare), fidelity: 'ok' };
}
