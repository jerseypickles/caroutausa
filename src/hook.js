import sharp from 'sharp';
import { Creative } from './models/creative.js';
import { generateHook, inventFontStyle } from './copy.js';
import { addHookOverlay, STORY_SIZE, SQUARE_SIZE } from './openai.js';
import { judgeHookFidelity } from './judge.js';

// Estilos de fuente/diseño BASE que rotamos para testear (el director explora nuevos además).
const FONT_STYLES = [
  { tag: 'condensed-bold', desc: 'a HEAVY CONDENSED SANS-SERIF UPPERCASE font (Anton / Archivo Black style), tight leading, bold streetwear impact' },
  { tag: 'clean-grotesque', desc: 'a CLEAN bold grotesque sans-serif (Helvetica Now / Inter Bold), minimal modern DTC, refined letter-spacing' },
  { tag: 'serif-editorial', desc: 'an elegant high-fashion SERIF (Vogue / GQ editorial), thin-to-bold contrast, aspirational magazine feel' },
  { tag: 'handstyle', desc: 'an urban HANDSTYLE / graffiti marker script, raw youthful street energy, hand-drawn but perfectly legible' },
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

// Genera la VARIANTE CON HOOK de un creativo: un hook de beneficio + callout del short,
// aplicado a la 9:16 (story) Y a la 1:1 (square). Guarda hookImageData/hookSquareImageData.
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
