import OpenAI from 'openai';
import { toFile } from 'openai';
import { config } from './config.js';
import { buildPrompt, fitLock } from './angles.js';

// timeout amplio: gpt-image puede tardar 4-5 min cuando OpenAI esta lento; 150s cortaba
// requests validas. 8 min cubre los dias lentos pero igual corta un cuelgue real.
const client = new OpenAI({ apiKey: config.openaiApiKey, timeout: 480000, maxRetries: 1 });

// Tamaños nativos por placement (divisibles por 16 para gpt-image-2).
export const STORY_SIZE = '1024x1824'; // 9:16 Reels/Stories
export const FEED_SIZE = '1024x1280';  // 4:5 Feed
export const SQUARE_SIZE = '1024x1024'; // 1:1 Feed cuadrado
const QUALITY = 'high';
// WebP comprimido: ~120KB vs ~3MB PNG (carga ~25x mas rapido en el panel).
const OUTPUT_FORMAT = 'webp';
const OUTPUT_COMPRESSION = 72;

// gpt-image-2 hace alta fidelidad nativamente y (segun doc) NO toma input_fidelity.
// gpt-image-1 / gpt-image-1-mini SI lo aceptan. En vez de afirmarlo estaticamente,
// lo intentamos y si la API lo rechaza, reintentamos sin el parametro.
function acceptsInputFidelity(model) {
  return /^gpt-image-1/.test(model);
}

// Descarga la foto real del producto una vez y la deja lista como Uploadable.
async function fetchSourceImage(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la imagen fuente (${res.status}): ${imageUrl}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
  return toFile(buffer, `source.${ext}`, { type: contentType });
}

// Estilo FIJO de marca para el hook (consistencia entre todos los creativos).
const HOOK_STYLE = `Add a clean, premium TEXT OVERLAY to this streetwear fitpic — high-end DTC fashion brand style. KEEP the photo, the model, the denim shorts, the sneakers and the background EXACTLY as they are; only add crisp typography on top, placed in the EMPTY negative space (open sky / wall / floor), NEVER over the model's face or body. Perfectly spelled, razor-sharp, professional kerning and alignment.`;

// Agrega el HOOK de texto sobre una imagen YA generada (story 9:16 o square 1:1).
// pngBuffer: la foto base en PNG. Devuelve b64 (webp) de la version con hook.
export async function addHookOverlay(pngBuffer, { hook, callout, size = STORY_SIZE, fontDesc = 'a HEAVY CONDENSED SANS-SERIF UPPERCASE font (Anton / Archivo Black style)' }) {
  const src = await toFile(pngBuffer, 'src.png', { type: 'image/png' });
  const prompt = `${HOOK_STYLE}

Text to add — ONLY these two elements (NO prices, NO discount codes, NO buttons, NO other text):
1) A bold HOOK in an open area, on up to two short lines: "${hook}" — set in ${fontDesc}. Color chosen to contrast its background (off-white over darker areas, charcoal over light areas) with a subtle soft shadow for legibility.
2) Small and light, just below the hook: "${callout}" in a THIN uppercase sans-serif, generous letter-spacing, muted grey.

Minimal, editorial, lots of breathing room. Like a designer made it.`;
  const params = { model: config.imageModel, image: src, prompt, size, quality: QUALITY, n: 1, output_format: OUTPUT_FORMAT, output_compression: OUTPUT_COMPRESSION };
  let response;
  try {
    response = await client.images.edit(params);
  } catch (err) {
    if (/output_(format|compression)/i.test(err?.message || '')) {
      delete params.output_format; delete params.output_compression;
      response = await client.images.edit(params);
    } else throw err;
  }
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error('hook overlay: la API no devolvio b64');
  return b64;
}

// Genera UNA variante para un angulo. Si viene referenceB64, se pasa como 2da
// imagen (referencia de estilo). Devuelve { b64 } o lanza error.
// (Con Standard/2GB ya no serializamos: el lock global colgaba todo si una request
//  se trababa. La concurrencia por-flujo ya esta limitada en enqueueJobs/carousel.)
export async function generateVariant({ imageUrl, productBackUrl = '', angleId, referenceB64, productDescription, creativeDirection = '', fitSpec = '', styleMode = 'organic', prompt: promptOverride, size = STORY_SIZE, hookSpec = null }) {
  const productImage = await fetchSourceImage(imageUrl);
  const model = config.imageModel;

  // Orden de imagenes: [producto frente, (producto espalda), (referencia)].
  // La 2da foto de producto (espalda) le da al modelo el garment completo -> tomas
  // de movimiento/espalda fieles. Solo se usa en los flujos buildPrompt (no override).
  const backImage = (productBackUrl && !promptOverride) ? await fetchSourceImage(productBackUrl).catch(() => null) : null;
  const imgs = [productImage];
  if (backImage) imgs.push(backImage);
  if (referenceB64) imgs.push(await toFile(Buffer.from(referenceB64, 'base64'), 'reference.png', { type: 'image/png' }));
  const image = imgs.length === 1 ? imgs[0] : imgs;

  // prompt custom (ej. carrusel/reframe) + fit, o el armado por angulo (ya incluye fit).
  const prompt = promptOverride
    ? `${promptOverride}${fitLock(fitSpec)}`
    : buildPrompt(angleId, { withReference: Boolean(referenceB64), productDescription, creativeDirection, fitSpec, styleMode, hasBack: Boolean(backImage), hookSpec });

  const params = {
    model, image, prompt, size, quality: QUALITY, n: 1,
    output_format: OUTPUT_FORMAT, output_compression: OUTPUT_COMPRESSION,
  };
  if (acceptsInputFidelity(model)) {
    params.input_fidelity = 'high';
  }

  let response;
  try {
    response = await client.images.edit(params);
  } catch (err) {
    const msg = err?.message || '';
    // Fallback: si rechaza algun parametro opcional, reintentar sin ellos.
    if (/input_fidelity/i.test(msg) && params.input_fidelity) {
      delete params.input_fidelity;
      response = await client.images.edit(params);
    } else if (/output_(format|compression)/i.test(msg)) {
      delete params.output_format; delete params.output_compression;
      response = await client.images.edit(params);
    } else {
      throw err;
    }
  }

  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('La API no devolvio b64_json');
  }
  // (Sin pase de realismo / sharp: colgaba la generacion y el usuario prefiere la
  //  imagen directa, limpia y normal. Devolvemos el webp de gpt-image tal cual.)
  return { b64 };
}
