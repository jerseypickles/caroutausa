import sharp from 'sharp';
import { Creative } from './models/creative.js';
import { generateHook, inventFontStyle } from './copy.js';
import { addHookOverlay, STORY_SIZE, SQUARE_SIZE } from './openai.js';
import { judgeHookFidelity } from './judge.js';

// Estilos de fuente/diseño BASE — alineados a la identidad CAROTA (blackletter/gótico,
// como el wordmark). El director explora nuevos PERO siempre on-brand (street/gótico).
const FONT_STYLES = [
  { tag: 'blackletter', desc: 'a bold BLACKLETTER / Old-English gothic typeface exactly like the CAROTA wordmark — medieval, sharp pointed serifs, dense and premium streetwear' },
  { tag: 'gothic-tattoo', desc: 'a gothic TATTOO-style blackletter, spiky and edgy street energy, hand-inked feel but perfectly legible' },
  { tag: 'condensed-bold', desc: 'a HEAVY CONDENSED SANS-SERIF UPPERCASE (Anton / Archivo Black), bold streetwear impact — pairs with the gothic logo' },
  { tag: 'blackletter-outline', desc: 'a BLACKLETTER gothic display rendered as a clean outline / hollow stroke, modern street take on the medieval CAROTA wordmark' },
];
// round-robin con arranque aleatorio; cada 5ta vez explora un estilo NUEVO (inventado).
let _fontIdx = Math.floor(Math.random() * FONT_STYLES.length);
let _calls = 0;
async function pickFontStyle() {
  _calls++;
  if (_calls % 5 === 0) { // explore
    const inv = await inventFontStyle();
    if (inv) return inv;
  }
  return FONT_STYLES[_fontIdx++ % FONT_STYLES.length]; // exploit (rota los base)
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
