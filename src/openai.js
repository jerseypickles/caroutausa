import OpenAI from 'openai';
import { toFile } from 'openai';
import { config } from './config.js';
import { buildPrompt } from './angles.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const SIZE = '1024x1536'; // vertical 2:3 para Reels/Stories/feed
const QUALITY = 'high';

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

// Genera UNA variante para un angulo. Si viene referenceB64, se pasa como 2da
// imagen (referencia de estilo). Devuelve { b64 } o lanza error.
export async function generateVariant({ imageUrl, angleId, referenceB64 }) {
  const productImage = await fetchSourceImage(imageUrl);
  const model = config.imageModel;

  // image puede ser una sola Uploadable o un array [producto, referencia].
  let image = productImage;
  if (referenceB64) {
    const refFile = await toFile(Buffer.from(referenceB64, 'base64'), 'reference.png', { type: 'image/png' });
    image = [productImage, refFile];
  }
  const prompt = buildPrompt(angleId, { withReference: Boolean(referenceB64) });

  const params = { model, image, prompt, size: SIZE, quality: QUALITY, n: 1 };
  if (acceptsInputFidelity(model)) {
    params.input_fidelity = 'high';
  }

  let response;
  try {
    response = await client.images.edit(params);
  } catch (err) {
    // Fallback: si rechaza input_fidelity, reintentar sin el.
    if (params.input_fidelity && /input_fidelity/i.test(err?.message || '')) {
      delete params.input_fidelity;
      response = await client.images.edit(params);
    } else {
      throw err;
    }
  }

  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('La API no devolvio b64_json');
  }
  return { b64 };
}
