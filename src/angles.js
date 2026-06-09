// Los prompts viven SOLO en este archivo. La estructura importa mas que el
// texto exacto: cada angulo = garment lock + escena/modelo/luz/mood.

// Bloquea el producto. El jean del MAIN es lo que vendemos: prioridad absoluta.
export const GARMENT_LOCK = `THE DENIM GARMENT IN THE FIRST IMAGE IS THE PRODUCT WE SELL.
It is the #1 priority of this image — reproduce it with 100% fidelity.
Keep EXACTLY, with zero changes: the precise denim wash and color tone, every
fade and whiskering pattern, the exact placement, size and shape of every rip,
tear and distressing, the stitching, the hardware, buttons and rivets, the raw
cutoff frayed hem, the cut, the length and the fit.
Do NOT clean up, restyle, lighten, darken, recolor, lengthen, shorten, smooth or
"improve" the denim in any way. Render it as the exact real photographed product.
If anything conflicts, the denim from the first image ALWAYS wins.`;

// Anti-IA: se concatena a cada prompt. Empuja look de iPhone organico, no estudio.
const ANTI_AI = `Make it look like a REAL, organic iPhone photo — a candid fitpic a
normal person would actually post, NOT an ad and NOT a professional shoot.
Shot on a recent iPhone: natural phone-camera rendering, slightly imperfect and
casual framing, real available light (window, overcast, golden hour) with real shadows.
PHONE-CAMERA COLOR, not professional or cinematic grading: a bit muted and natural,
real white balance, slightly flat dynamic range, never oversaturated, no HDR glow,
no glossy studio polish.
Natural skin with visible pores and fine grain, no waxy or plastic skin, no
over-smoothing, no perfect symmetry. Real lived-in environment with everyday texture.`;

// Referencia de estilo (imagen 2): SUBORDINADA al producto. Solo aporta el resto
// del look y la escena; jamas toca el jean.
const STYLE_REFERENCE = `The SECOND image is ONLY a styling reference and is SECONDARY
to the product. From it, take ONLY the OUTFIT and styling: the top/jacket, the
footwear/sneakers, the accessories, and how the clothes are worn.
Do NOT copy its background, location or color grading — place the model in a real,
organic everyday setting and keep the natural iPhone look described below; the
reference is for the outfit, not the scene.
NEVER take the pants, shorts or bottoms from the second image — the bottoms are
ALWAYS the exact denim garment from the FIRST image, with its wash, rips, hem and
length unchanged. Do NOT copy the face or identity from the second image.`;

export const ANGLES = {
  realista: {
    id: 'realista',
    label: 'Fitpic natural (organico, no ad)',
    prompt: `A candid streetwear fitpic that looks like organic social content, not an ad.
Young urban man, natural pose, shot on an iPhone, slightly tilted framing.
Real room or street with everyday clutter, window daylight or overcast light.`,
  },
  realismo_completo: {
    id: 'realismo_completo',
    label: 'Maximo realismo foto (anti-AI)',
    prompt: `Maximum realism, an unmistakably real organic iPhone snapshot — never a
studio, editorial or professional camera look. Visible fine grain, real fabric
texture on the denim, candid casual framing. Golden hour or overcast daylight with
directional real shadows.`,
  },
  gancho_click: {
    id: 'gancho_click',
    label: 'Hero shot que detiene el scroll',
    prompt: `A strong hero shot built to stop the scroll on the very first frame.
Confident face, attitude and micro motion, dynamic real-light composition.
The first frame reads bold: face, movement and energy, with real light.`,
  },
  llamada_atencion: {
    id: 'llamada_atencion',
    label: 'Alto impacto, color-block, lee como drop',
    prompt: `High-impact shot that reads as a fresh drop. Bold color-block background
with real texture (painted wall, real surface), strong but real light.
Striking and scroll-stopping while still looking like a real photograph.`,
  },
};

export const DEFAULT_ANGLE = 'realista';

// Reframe del placement: misma foto (imagen 2 = el 9:16) recompuesta a 4:5 de feed.
export function buildFeedReframePrompt(productDescription = '') {
  return `${GARMENT_LOCK}

The SECOND image is the SAME fitpic shot vertically (9:16). Reproduce the EXACT same
photo — same real model, same outfit, same location, same pose, same lighting and
colors — but recomposed for a 4:5 FEED frame (a bit wider, less tall). Keep the full
denim shorts and the outfit clearly visible. It must read as the same photo, just
framed for feed, not a new scene.
${productDescription ? `\nThe product to preserve exactly: ${productDescription}` : ''}

Real organic iPhone photo, phone-camera color (not professional grading), natural
light, slight grain, candid framing.`;
}

// Arma el prompt final: garment lock + descripcion real del producto + (referencia)
// + escena + anti-IA. La descripcion (de Shopify) ancla que jean preservar.
// Fit/silueta exacta (del Size Finder): ancla que tan ancho vs apretado va el short.
export function fitLock(fitSpec = '') {
  if (!fitSpec) return '';
  return `\n\nEXACT FIT & SILHOUETTE (reproduce precisely — do NOT make the shorts slimmer, wider, longer or shorter than this): ${fitSpec}`;
}

export function buildPrompt(angleId, { withReference = false, productDescription = '', creativeDirection = '', fitSpec = '' } = {}) {
  const angle = ANGLES[angleId];
  if (!angle && !creativeDirection) {
    throw new Error(`Angulo desconocido: ${angleId}. Validos: ${Object.keys(ANGLES).join(', ')}`);
  }
  const desc = productDescription
    ? `\n\nThe exact product to preserve (keep faithful to this): ${productDescription}`
    : '';
  const ref = withReference ? `\n\n${STYLE_REFERENCE}` : '';
  // El director (Claude) reemplaza la escena fija del angulo; si no hay, cae al fijo.
  const scene = creativeDirection || angle.prompt;
  return `${GARMENT_LOCK}${fitLock(fitSpec)}${desc}${ref}\n\n${scene}\n\n${ANTI_AI}`;
}
