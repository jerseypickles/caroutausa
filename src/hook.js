import sharp from 'sharp';
import { Creative } from './models/creative.js';
import { generateHook, inventFontStyle } from './copy.js';
import { addHookOverlay, STORY_SIZE, SQUARE_SIZE } from './openai.js';
import { judgeHookFidelity } from './judge.js';

// Estilos de fuente/diseño BASE — alineados a la identidad CAROTA (blackletter/gótico,
// como el wordmark). El director explora nuevos PERO siempre on-brand (street/gótico).
// El usuario eligió ESTA fuente: condensada bold tipo "LIGHT. LOOSE." (Anton/Archivo Black).
// Es la única — sin rotación ni exploración (se puede re-activar si quiere testear más).
const FONT_STYLES = [
  { tag: 'condensed-bold', desc: 'a HEAVY CONDENSED SANS-SERIF UPPERCASE, exactly like a bold "LIGHT. LOOSE." ad headline (Anton / Archivo Black) — thick, tall, tightly stacked lines, off-white with a subtle soft shadow, premium streetwear' },
];
async function pickFontStyle() {
  return FONT_STYLES[0];
}

// Decide el HOOK (texto + fuente) ANTES de generar -> para bakearlo en la misma pasada.
// Devuelve { hookLine, callout, fontTag, fontDesc }.
export async function planHook({ product, wash }) {
  const { hook, fit } = await generateHook({ product, wash });
  const washTxt = (wash || '').replace(/\s*wash\s*/i, '').toUpperCase().trim();
  const callout = `${washTxt ? washTxt + ' WASH · ' : ''}${fit}`;
  const font = await pickFontStyle();
  return { hookLine: hook, callout, fontTag: font.tag, fontDesc: font.desc };
}

// Genera la VARIANTE CON HOOK por separado (2do pase) — se mantiene para re-hookear
// manualmente creativos viejos. El flujo AUTO ahora lo bakea en la misma generación.
export async function generateHookForCreative(creativeId) {
  const c = await Creative.findById(creativeId).select('+imageData +squareImageData +feedImageData product wash').lean();
  if (!c?.imageData) throw new Error('Creativo sin imagen base');

  const { hook, fit } = await generateHook({ product: c.product, wash: c.wash });
  const washTxt = (c.wash || '').replace(/\s*wash\s*/i, '').toUpperCase().trim();
  const callout = `${washTxt ? washTxt + ' WASH · ' : ''}${fit}`;
  const font = await pickFontStyle(); // estilo de fuente (rotado o explorado)

  // 9:16 story (siempre)
  const storyPng = await sharp(Buffer.from(c.imageData, 'base64')).png().toBuffer();
  const hookStory = await addHookOverlay(storyPng, { hook, callout, size: STORY_SIZE, fontDesc: font.desc });

  // 1:1 square (si existe)
  let hookSquare = null;
  const sq = c.squareImageData || c.feedImageData;
  if (sq) {
    const sqPng = await sharp(Buffer.from(sq, 'base64')).png().toBuffer();
    hookSquare = await addHookOverlay(sqPng, { hook, callout, size: SQUARE_SIZE, fontDesc: font.desc });
  }

  // CHEQUEO DE FIDELIDAD: el pase del hook NO debe tocar el short. Comparamos limpia vs
  // hook (ignorando el texto). Si cambió, descartamos el hook y queda la foto limpia.
  const checkStory = await judgeHookFidelity(c.imageData, hookStory);
  const checkSq = (hookSquare && sq) ? await judgeHookFidelity(sq, hookSquare) : { same: true, note: '' };
  if (!checkStory.same || !checkSq.same) {
    await Creative.findByIdAndUpdate(creativeId, { hookImageData: null, hookSquareImageData: null, hookLine: null, fontTag: null });
    return { hook, fontTag: font.tag, discarded: true, reason: [checkStory.note, checkSq.note].filter(Boolean).join(' / ') || 'el hook alteró el short' };
  }

  await Creative.findByIdAndUpdate(creativeId, {
    hookImageData: hookStory,
    hookSquareImageData: hookSquare,
    hookLine: hook,
    fontTag: font.tag,
  });
  return { hook, callout, fontTag: font.tag, square: Boolean(hookSquare), fidelity: 'ok' };
}
