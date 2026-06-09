import OpenAI from 'openai';
import { config } from './config.js';

// El "Size Finder" de cada producto vive server-rendered en el HTML de la pagina
// (modal con tabla de medidas + fit rating). Es la VERDAD del fit: que tan ancho o
// apretado es el short (hip vs waist, thigh, leg opening, largo). Lo scrapeamos y un
// LLM lo normaliza a un "fit spec" preciso que ancla la silueta en el prompt.
const client = new OpenAI({ apiKey: config.openaiApiKey });
const STORE = 'https://carotaus.com';

// Scrapea el texto del size-finder (medidas + rating) de la pagina del producto.
export async function scrapeSizeFinder(handle) {
  if (!handle) return null;
  try {
    const res = await fetch(`${STORE}/products/${handle}`);
    if (!res.ok) return null;
    const html = await res.text();
    const i = html.indexOf('size-finder-modal');
    if (i < 0) return null;
    let text = html.slice(i, i + 5000)
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    // corta el <script> inline que sigue a la tabla
    const cut = text.indexOf('(function');
    if (cut > 0) text = text.slice(0, cut).trim();
    return text.length > 30 ? text.slice(0, 1200) : null;
  } catch {
    return null;
  }
}

// Convierte size guide + descripcion en un fit spec preciso para gpt-image.
// Devuelve { fit, cut, length, measures } o null.
export async function deriveFitSpec({ title, description, sizeText }) {
  if (!sizeText && !description) return null;
  try {
    const completion = await client.chat.completions.create({
      model: config.judgeModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You translate a denim short's size guide + product copy into a precise FIT/SILHOUETTE spec for an AI image generator. Focus ONLY on shape: how wide vs slim it is through the hip and thigh, the leg width and opening, where the hem hits (length), the rise, and the overall cut. Use the measurements to be exact and objective: a large hip-minus-waist gap, or a wide thigh / leg-opening, means a RELAXED / BAGGY / WIDE cut; a small gap and narrow leg opening means a SLIM / FITTED / TAPERED cut. Never invent rips, wash or color — only silhouette and length.`,
        },
        {
          role: 'user',
          content: `Title: ${title || ''}
Description: ${description || '(none)'}
Size guide (measurements + fit rating): ${sizeText || '(none)'}

Return ONLY JSON:
{
  "fit": "<one precise sentence describing the exact silhouette for the image generator — width through hip/thigh, leg width/opening, where the hem lands, rise, overall cut. e.g. 'relaxed wide straight-leg denim short, roomy through the hip and thigh, wide straight (not tapered) leg, hem landing right at the knee, mid rise'>",
  "cut": "<2-4 words, e.g. relaxed wide straight>",
  "length": "<e.g. knee-length / mid-thigh / above-knee>",
  "measures": { "waistCm": <num|null>, "hipCm": <num|null>, "thighCm": <num|null>, "legOpeningCm": <num|null>, "lengthCm": <num|null> }
}
Use a mid size from the table. If a measure is absent, use null.`,
        },
      ],
    });
    const p = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    if (!p.fit) return null;
    return {
      fit: String(p.fit).slice(0, 320),
      cut: String(p.cut || '').slice(0, 40),
      length: String(p.length || '').slice(0, 40),
      measures: p.measures && typeof p.measures === 'object' ? p.measures : {},
    };
  } catch (err) {
    console.error('[sizeFinder] deriveFitSpec fallo:', err.message);
    return null;
  }
}

// Helper: scrape + derive en un paso. Devuelve { fitSpec, fitMeasures, sizeText } o null.
export async function resolveFit({ handle, title, description }) {
  const sizeText = await scrapeSizeFinder(handle);
  const spec = await deriveFitSpec({ title, description, sizeText });
  if (!spec) return null;
  return { fitSpec: spec.fit, fitCut: spec.cut, fitLength: spec.length, fitMeasures: spec.measures, sizeText: sizeText || '' };
}
