import { generateVariant } from './openai.js';
import { GARMENT_LOCK, buildFlatlayPrompt } from './angles.js';
import { Carousel } from './models/carousel.js';
import { Product } from './models/product.js';
import { judgeFidelity } from './judge.js';
import { generateCopy } from './copy.js';
import { directCreative } from './director.js';
import { planHook } from './hook.js';
import { pickScene } from './refs.js';
import { config } from './config.js';

const IPHONE = `Real organic iPhone photo: phone-camera color (not professional/cinematic
grading), natural available light, slight grain, candid casual framing. Natural skin,
no waxy plastic look, no HDR glow, no studio polish.`;

// Secuencia de poses: cada card una toma DISTINTA del mismo shoot (no casi iguales),
// para que el carrusel tenga flujo y se vea como una serie real de fotos.
const POSE_SEQUENCE = [
  'a relaxed THREE-QUARTER turn, weight shifted onto one leg, one hand in a pocket, looking slightly off-camera — different angle and stance from the previous frame',
  'WALKING mid-stride across or toward the camera, a candid step with natural motion and energy, framed full-body',
  'a SIDE PROFILE or from-behind view that shows how the fit and the shorts sit from another angle, casual and unposed',
  'a slightly LOWER camera angle looking up, confident full-body stance, a fresh composition from the others',
];

// Card de pose: misma escena/modelo/color que el hero (imagen 2), pero una pose
// claramente distinta (poseBrief) -> la secuencia tiene variedad real.
function posePrompt(productDescription, poseBrief = '') {
  return `${GARMENT_LOCK}

The SECOND image is a previous frame of this EXACT same fitpic session. Keep the SAME
real model, the SAME location and background, the SAME outfit, and the SAME lighting
and color grading as the second image — like another photo taken the same minute, same
place, same person.
NOW change to a CLEARLY DIFFERENT shot: ${poseBrief || 'a new pose and camera angle'}.
It must read as a distinct frame in the sequence, not a near-duplicate of the others.
Do NOT include ANY text or typography overlay — keep this photo completely CLEAN (any text from the source frame belongs only on the first card).
${productDescription ? `\nThe product to preserve exactly: ${productDescription}` : ''}

${IPHONE}`;
}

// Card de detalle: close-up CERRADO del short tal como lo lleva el modelo (mismo
// setting/color del hero). Cierra el set mostrando la tela/textura real.
function detailPrompt(productDescription) {
  return `${GARMENT_LOCK}

The SECOND image is the same fitpic session — same real model, same location, same
lighting and color. Now take a TIGHT CLOSE-UP of the denim shorts AS WORN: crop in close
on the shorts on the model's lower body (waist-to-knee), filling most of the frame, like
a phone photo zoomed in to show the fit and fabric. Show the real denim texture and wash,
the raw cutoff frayed hem, the stitching, pockets and any hardware up close and sharp.
Same mood and color grading as the second image. It is the SAME shorts, just closer.
Do NOT include ANY text or typography overlay — keep this photo completely CLEAN.
${productDescription ? `\nThe product: ${productDescription}` : ''}

${IPHONE}`;
}

// Genera un carrusel cohesivo: hero -> N poses + 1 detail, usando el hero como
// referencia para que compartan modelo/fondo/color. Devuelve [{role,b64}].
export async function generateCarousel({ imageUrl, productBackUrl = '', productDescription, refDna = '', refImageB64 = '', product, wash, fitSpec = '', cards = 3 }) {
  // 1. Hero (set el look): el director arma un outfit INSPIRADO en el ADN de la
  // referencia (no clon); las demas cards encadenan del hero (cohesion). La 2da foto
  // (espalda) le da el garment completo para las poses de movimiento/espalda.
  const scene = await pickScene().catch(() => null);
  const dir = await directCreative({ product, wash, angle: 'realista', refDna, sceneDna: scene?.dna || '', mode: 'carouselHero' });
  const creativeDirection = dir?.text || '';
  // HOOK bakeado SOLO en el HERO (la 1ra card, el scroll-stopper). Las poses/close-up van limpias.
  let hookSpec = null;
  if (config.hookAuto) {
    try { hookSpec = await planHook({ product, wash, fitSpec }); } catch (e) { console.error('[carousel] planHook:', e.message); }
  }
  // La IMAGEN de la ref va a gpt-image (guía visual) -> el hero copia el outfit fiel.
  const hero = await generateVariant({ imageUrl, productBackUrl, angleId: 'realista', productDescription, creativeDirection, fitSpec, hookSpec, referenceB64: refImageB64 || null });
  const heroB64 = hero.b64;

  // 2. Set TIGHT (max 3): hero (look completo) + N poses + 1 close-up del short.
  // Secuencial (no en paralelo: el plan starter se queda sin RAM y reinicia).
  const out = [{ role: 'hero', b64: heroB64 }];
  const poseCount = Math.max(0, cards - 2); // hero + close-up + poses
  for (let i = 0; i < poseCount; i++) {
    const poseBrief = POSE_SEQUENCE[i % POSE_SEQUENCE.length];
    const r = await generateVariant({ imageUrl, referenceB64: heroB64, productDescription, fitSpec, prompt: posePrompt(productDescription, poseBrief) });
    out.push({ role: 'pose', b64: r.b64 });
  }
  // Card de cierre: CLOSE-UP del short como lo lleva el modelo (mismo set que el hero).
  const close = await generateVariant({ imageUrl, referenceB64: heroB64, productDescription, fitSpec, prompt: detailPrompt(productDescription) });
  out.push({ role: 'detail', b64: close.b64 });

  out.castTag = dir?.castTag; out.sceneTag = dir?.sceneTag; // ADN para aprendizaje
  out.hookLine = hookSpec?.hookLine || null; out.fontTag = hookSpec?.fontTag || null;
  return out;
}

// Genera el carrusel en background, juzga la fidelidad del jean en cada card,
// y genera el copy. Actualiza el doc Carousel.
export async function generateCarouselInBackground(carouselId) {
  const doc = await Carousel.findById(carouselId).select('+referenceImageData').lean();
  if (!doc) return;

  let cards;
  let fitSpec = '';
  try {
    const prod = doc.shopifyProductId ? await Product.findOne({ shopifyId: doc.shopifyProductId }).lean() : null;
    fitSpec = prod?.fitSpec || '';
    const productDescription = [doc.product, prod?.description].filter(Boolean).join('. ');
    cards = await generateCarousel({
      imageUrl: doc.sourceImageUrl,
      productBackUrl: prod?.images?.[1] || '',
      productDescription,
      refDna: doc.referenceDna || '',
      refImageB64: doc.referenceImageData || '',
      product: doc.product,
      wash: doc.wash,
      fitSpec: prod?.fitSpec || '',
      cards: 3,
    });
  } catch (err) {
    console.error(`[carousel] fallo generacion (${carouselId}):`, err.message);
    await Carousel.findByIdAndUpdate(carouselId, { genStatus: 'failed', genError: err.message, fidelityStatus: 'failed' });
    return;
  }

  await Carousel.findByIdAndUpdate(carouselId, {
    cards: cards.map((c, i) => ({ role: c.role, order: i, imageData: c.b64 })),
    castTag: cards.castTag, sceneTag: cards.sceneTag,
    hookLine: cards.hookLine, fontTag: cards.fontTag,
    genStatus: 'ready',
  });

  // Juez de fidelidad por card (el jean debe preservarse en todas). Overall = el peor.
  try {
    const verdicts = await Promise.all(cards.map((c) =>
      judgeFidelity({ sourceImageUrl: doc.sourceImageUrl, b64: c.b64, fitSpec }).catch(() => null)));
    const scores = verdicts.filter(Boolean).map((v) => v.score);
    const overall = scores.length ? Math.min(...scores) : null;
    const fresh = await Carousel.findById(carouselId);
    if (fresh) {
      fresh.cards.forEach((cd, i) => {
        const v = verdicts[i];
        if (v) { cd.fidelityScore = v.score; cd.fidelityVerdict = v.verdict; cd.fidelityIssues = v.issues; }
      });
      fresh.fidelityStatus = 'done';
      fresh.fidelityScore = overall;
      fresh.fidelityVerdict = overall != null && overall >= config.fidelityPass ? 'pass' : 'fail';
      await fresh.save();
    }
  } catch (err) {
    console.error(`[carousel] juez fallo (${carouselId}):`, err.message);
    await Carousel.findByIdAndUpdate(carouselId, { fidelityStatus: 'failed' });
  }

  // Copy del carrusel.
  try {
    const prod = doc.shopifyProductId ? await Product.findOne({ shopifyId: doc.shopifyProductId }).lean() : null;
    const copy = await generateCopy({ product: doc.product, wash: doc.wash, angle: 'carousel', description: prod?.description });
    await Carousel.findByIdAndUpdate(carouselId, { copy: { ...copy, edited: false } });
  } catch (err) { console.error(`[carousel] copy fallo (${carouselId}):`, err.message); }
}
