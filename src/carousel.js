import { generateVariant } from './openai.js';
import { GARMENT_LOCK } from './angles.js';
import { Carousel } from './models/carousel.js';
import { Product } from './models/product.js';
import { judgeFidelity } from './judge.js';
import { generateCopy } from './copy.js';
import { directCreative } from './director.js';
import { config } from './config.js';

const IPHONE = `Real organic iPhone photo: phone-camera color (not professional/cinematic
grading), natural available light, slight grain, candid casual framing. Natural skin,
no waxy plastic look, no HDR glow, no studio polish.`;

// Card de pose: misma escena/modelo/color que el hero (imagen 2), solo cambia la pose.
function posePrompt(productDescription) {
  return `${GARMENT_LOCK}

The SECOND image is a previous frame of this EXACT same fitpic session. Keep the SAME
real model, the SAME location and background, the SAME outfit, and the SAME lighting
and color grading as the second image. ONLY change the pose and camera angle for
variety (walking, three-quarter turn, side view, hands in pockets, mid-step) — like
another photo taken the same minute, same place, same person.
${productDescription ? `\nThe product to preserve exactly: ${productDescription}` : ''}

${IPHONE}`;
}

// Card de detalle: close-up del jean en el mismo setting/color del hero.
function detailPrompt(productDescription) {
  return `${GARMENT_LOCK}

The SECOND image is the same look and scene. Now produce a CLOSE-UP DETAIL shot of the
denim shorts in that same setting, lighting and colors: fill the frame with the shorts,
showing the wash, the raw cutoff frayed hem, the stitching, pockets and any hardware up
close. Same mood and color grading as the second image.
${productDescription ? `\nThe product: ${productDescription}` : ''}

${IPHONE}`;
}

// Genera un carrusel cohesivo: hero -> N poses + 1 detail, usando el hero como
// referencia para que compartan modelo/fondo/color. Devuelve [{role,b64}].
export async function generateCarousel({ imageUrl, productDescription, heroReferenceB64, product, wash, fitSpec = '', cards = 5 }) {
  // 1. Hero (set el look): el director (Claude) inventa la escena del set; las demas
  // cards encadenan del hero, asi que la cohesion se mantiene sola.
  const creativeDirection = await directCreative({ product, wash, angle: 'realista', withReference: Boolean(heroReferenceB64), mode: 'carouselHero' });
  const hero = await generateVariant({ imageUrl, angleId: 'realista', referenceB64: heroReferenceB64, productDescription, creativeDirection, fitSpec });
  const heroB64 = hero.b64;

  // 2. Poses + detail en paralelo, cada una con el hero como 2da imagen (cohesion).
  const poseCount = Math.max(0, cards - 2); // hero + detail + poses
  const tasks = [];
  for (let i = 0; i < poseCount; i++) {
    tasks.push(
      generateVariant({ imageUrl, referenceB64: heroB64, productDescription, fitSpec, prompt: posePrompt(productDescription) })
        .then((r) => ({ role: 'pose', b64: r.b64 }))
    );
  }
  tasks.push(
    generateVariant({ imageUrl, referenceB64: heroB64, productDescription, fitSpec, prompt: detailPrompt(productDescription) })
      .then((r) => ({ role: 'detail', b64: r.b64 }))
  );
  const rest = await Promise.all(tasks);

  return [{ role: 'hero', b64: heroB64 }, ...rest];
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
      productDescription,
      heroReferenceB64: doc.referenceImageData,
      product: doc.product,
      wash: doc.wash,
      fitSpec: prod?.fitSpec || '',
      cards: 5,
    });
  } catch (err) {
    console.error(`[carousel] fallo generacion (${carouselId}):`, err.message);
    await Carousel.findByIdAndUpdate(carouselId, { genStatus: 'failed', genError: err.message, fidelityStatus: 'failed' });
    return;
  }

  await Carousel.findByIdAndUpdate(carouselId, {
    cards: cards.map((c, i) => ({ role: c.role, order: i, imageData: c.b64 })),
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
