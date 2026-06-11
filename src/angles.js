// Los prompts viven SOLO en este archivo. La estructura importa mas que el
// texto exacto: cada angulo = garment lock + escena/modelo/luz/mood.

// Bloquea el producto. El jean del MAIN es lo que vendemos: prioridad absoluta.
export const GARMENT_LOCK = `THE DENIM GARMENT IN THE PRODUCT PHOTO(S) IS THE PRODUCT WE SELL.
It is the #1 priority of this image — reproduce it with 100% fidelity.
Keep EXACTLY, with zero changes: the precise denim wash and color tone, every
fade and whiskering pattern, the exact placement, size and shape of every rip,
tear and distressing, the stitching, the hardware, buttons and rivets, the raw
cutoff frayed hem, the cut, the length and the fit.
Do NOT clean up, restyle, lighten, darken, recolor, lengthen, shorten, smooth or
"improve" the denim in any way. Render it as the exact real photographed product.
If anything conflicts, the real photographed product ALWAYS wins.`;

// Cuando hay 2da foto de producto (espalda): el modelo conoce el garment completo y
// puede renderizar tomas de espalda / movimiento fieles.
export const BACK_NOTE = `TWO product photos are provided: one shows the shorts from the FRONT
and the other shows the EXACT SAME shorts from the BACK (back pockets, yoke, rear hem). Use
BOTH to reproduce the garment accurately from ANY angle — front, side, three-quarter and back —
so movement and back-facing shots show the real back of these shorts, not an invented one.`;

// Anti-IA: se concatena a cada prompt. Empuja look de iPhone organico, no estudio.
const ANTI_AI = `Make it look like a REAL, organic iPhone photo — a candid fitpic a
normal person would actually post, NOT an ad and NOT a professional shoot.
Shot on a recent iPhone: natural phone-camera rendering, slightly imperfect and
casual framing, real available SOFT, EVEN light (big window light, bright overcast, open shade).
PHONE-CAMERA COLOR, not professional or cinematic grading: NATURAL, true-to-life color like
a real recent iPhone photo — real and a little organic, with REAL contrast and clean tones
(whites stay clean, blacks stay real, a graphic/logo can pop). NOT washed out, dull, flat or
grey — but also NEVER oversaturated, punchy, HDR, teal-orange graded or glossy. Real natural
NEUTRAL white balance — NOT a warm orange/golden cast.
LIGHT: prefer SOFT, EVEN, diffuse light and a clean, fairly neutral palette (soft whites,
creams, light wood, light grey). AVOID harsh direct sun, hard deep shadows and warm golden walls.
Natural skin with visible pores and fine grain, real ordinary-looking face, no waxy or
plastic skin, no over-smoothing, no perfect symmetry, no model-perfect beauty-AI look.
Real, clean lived-in environment with everyday texture.

FRAMING: shoot fairly CLOSE so the MODEL FILLS most of the frame — a tight full-body or
three-quarter crop where the model is large and prominent and the outfit + the denim shorts
read clearly. Do NOT leave the model small and distant with lots of empty background.`;

// Look de campaña: shoot de marca REAL fotografiado con cámara pro (no render IA).
// Brief fotográfico profundo basado en analizar campañas reales (Lorenzo/Represent).
const CAMPAIGN_LOOK = `Shoot this like a REAL high-end menswear brand campaign captured on a professional
camera — the actual editorial look of brands like Lorenzo Worldwide, Represent or Fear of
God Essentials. It must read as a genuine PHOTOGRAPH, never an AI render.

PHOTOGRAPHY: real full-frame or medium-format camera with a 50–85mm prime lens; natural,
slightly shallow depth of field with true optical falloff (no fake plastic bokeh); a faint
fine film grain; natural dynamic range where highlights keep detail and shadows stay soft
and real; true-to-life color that is restrained and slightly cool — NEVER HDR, oversaturated,
over-sharpened, hazy-glossy or digitally "clean".

LIGHT: real natural daylight with ONE clear sun direction, soft believable shadows and real
specular highlights on fabric; a subtle lens flare or gentle bloom is welcome.

THE PERSON MUST READ 100% REAL: natural skin with visible pores, fine texture and tiny
imperfections; real individual strands of hair; a genuine, relaxed-confident expression and
natural facial asymmetry. ABSOLUTELY NOT waxy, plastic, airbrushed, over-smoothed,
over-symmetric or "AI-pretty" — a real human being, photographed.

MATERIALS — show real texture and detail: the nap of the fleece/knit on top, the weave and
fades of the denim, the leather/mesh and stitching of the SNEAKERS, the glint of any chain —
all sharp, tactile and believable, with real weight, folds and wear. Expensive, intentional
and editorial, yet unmistakably a real photo.`;

// Referencia de estilo (imagen 2): SUBORDINADA al producto. Solo aporta el resto
// del look y la escena; jamas toca el jean.
const STYLE_REFERENCE = `The LAST image provided is the OUTFIT / STYLE REFERENCE. COPY its outfit
on the model as FAITHFULLY as possible — it must clearly read as the SAME look:
- The SAME top type and layering (tee/hoodie/jacket), worn the same boxy/oversized/fitted way.
- The SAME GRAPHIC on the top: match its style, typography, placement and scale closely. Any
  TEXT must be rendered FORWARD and perfectly readable — NEVER mirrored or backwards, even if
  the reference looks reversed (a mirror selfie).
- The EXACT same sneakers — same model and colorway (e.g. chunky dad-runners stay chunky
  dad-runners; do NOT swap them for white Air Force 1s).
- The SAME accessories: cap (same style/placement), chains, bag, socks, watch.
You MAY recolor the overall fit to a different palette, but keep every other element the same.
BRAND-SAFE: if the reference shows a recognizable third-party BRAND wordmark or logo on the
top, replace ONLY that text/logo with ORIGINAL wording/art in the exact SAME visual style —
keep the look, drop the brand name. (Real sneakers on-foot are fine to reproduce.)
Do NOT copy its background, location or color grading — place the model in the scene described
below with a natural iPhone look; the reference is for the OUTFIT, not the scene.
NEVER take the pants, shorts or bottoms from the reference image — the bottoms are ALWAYS the
exact denim PRODUCT, with its wash, rips, hem and length unchanged.
Do NOT copy the face or identity from the reference image.`;

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

// Reframe del placement: misma foto (imagen 2 = el 9:16) recompuesta a otro frame.
function reframePrompt(productDescription, frameDesc, hookSpec = null) {
  // El 9:16 fuente ya trae el hook -> en el reframe lo RE-UBICAMOS limpio para el aspecto
  // nuevo (re-render, no recorte), con el mismo texto y fuente.
  const hookNote = hookSpec
    ? `\n\nThe source photo has a text overlay — keep the SAME words and font style, but RE-LAY it cleanly for ${frameDesc}: in the empty negative space, NEVER over the face or the shorts, crisp and well-placed for this frame.${hookOverlay(hookSpec)}`
    : '';
  return `${GARMENT_LOCK}

The SECOND image is the SAME fitpic shot vertically (9:16). Reproduce the EXACT same
photo — same real model, same outfit, same location, same pose, same lighting and
colors — but recomposed for ${frameDesc}. Keep the full denim shorts and the outfit
clearly visible. It must read as the SAME photo, just reframed, not a new scene.
${productDescription ? `\nThe product to preserve exactly: ${productDescription}` : ''}${hookNote}

Real organic iPhone photo, phone-camera color (not professional grading), natural
light, candid framing.`;
}
export const buildFeedReframePrompt = (d = '', hookSpec = null) => reframePrompt(d, 'a 4:5 FEED frame (a bit wider, less tall)', hookSpec);
export const buildSquareReframePrompt = (d = '', hookSpec = null) => reframePrompt(d, 'a 1:1 SQUARE frame (centered, equal width and height)', hookSpec);

// Flat-lay / packshot: el short SOLO sobre superficie solida con sombra real. Sin
// modelo. Producto como heroe -> formato que convierte mucho en Meta.
export function buildFlatlayPrompt(productDescription = '', fitSpec = '') {
  return `${GARMENT_LOCK}${fitLock(fitSpec)}${productDescription ? `\n\nThe exact product: ${productDescription}` : ''}

Photograph this exact denim short as a raw, authentic STILL-LIFE flat-lay — NO model, NO
person, NO legs, just the garment itself, laid flat and shot straight from ABOVE (top-down).
SURFACE: lay it on a real, weathered CONCRETE FLOOR — the kind in a warehouse, garage or
storage unit: bare polished-but-worn grey concrete with natural cracks, hairline lines,
stains, scuffs, dust and uneven mottled tones, real industrial texture. NOT a clean studio
backdrop, NOT a table, NOT a colored paper sweep.
LIGHT: soft natural diffuse daylight (overcast or open warehouse light) from one side,
casting ONE gentle, real soft-edged shadow under the garment. MUTED, slightly desaturated,
true-to-life color — never bright, glossy, HDR, warm-filtered or oversaturated.
The shorts fill most of the frame, laid out naturally and a little imperfectly (one leg
slightly turned, soft real fabric folds). Real denim texture, fades, the raw frayed hem,
pockets and stitching all sharp, tactile and visible.
This is the gritty vintage-reseller / streetwear-archive look (think Grailed / vintage
seller listings). It MUST look like a REAL photo someone took of the shorts on a concrete
floor with a phone — absolutely NOT an AI render, not plastic, not too clean: real grain,
real concrete, real fabric, real shadow. No props, no text, no hangers.`;
}

// Arma el prompt final: garment lock + descripcion real del producto + (referencia)
// + escena + anti-IA. La descripcion (de Shopify) ancla que jean preservar.
// Fit/silueta exacta (del Size Finder): ancla que tan ancho vs apretado va el short.
export function fitLock(fitSpec = '') {
  if (!fitSpec) return '';
  return `\n\nEXACT FIT & SILHOUETTE (reproduce precisely — do NOT make the shorts slimmer, wider, longer or shorter than this): ${fitSpec}`;
}

// Brand-safe: nada de logos de OTRAS marcas en la parte de arriba (es un ad de CAROTA).
const BRAND_SAFE = `TOP GRAPHICS: the top (tee, hoodie, knit) can and often SHOULD carry a bold ORIGINAL graphic / art print / illustration (streetwear graphic energy — a big front print, collage, character or image), not a plain blank. BUT show NO real third-party brand logo, wordmark or famous brand name — the design must be original/generic, the brand's own apparel. (Real sneakers on the feet are fine.)`;

// Instrucción del HOOK para bakearlo EN la misma generación (una sola pasada). El texto
// va en el espacio negativo, NUNCA sobre la cara ni sobre el short (no lo altera).
export function hookOverlay(spec) {
  if (!spec || !spec.hookLine) return ''; // null-safe (el default {} no cubre null)
  const { hookLine, callout, fontDesc } = spec;
  return `\n\nTEXT OVERLAY (part of the composition, like a high-end DTC ad): place a clean premium typographic overlay in the EMPTY negative space — NEVER over the model's face or over the denim shorts, and it must NOT change the shorts in any way. (1) the HOOK "${hookLine}" set in ${fontDesc}, color chosen to contrast its background with a subtle soft shadow, perfectly spelled and razor-sharp. (2) small and light just below: "${callout}" in a THIN uppercase sans-serif, generous letter-spacing, muted grey. Minimal, editorial, lots of breathing room.`;
}

export function buildPrompt(angleId, { withReference = false, productDescription = '', creativeDirection = '', fitSpec = '', styleMode = 'organic', hasBack = false, hookSpec = null } = {}) {
  const angle = ANGLES[angleId];
  if (!angle && !creativeDirection) {
    throw new Error(`Angulo desconocido: ${angleId}. Validos: ${Object.keys(ANGLES).join(', ')}`);
  }
  const back = hasBack ? `\n\n${BACK_NOTE}` : '';
  const desc = productDescription
    ? `\n\nThe exact product to preserve (keep faithful to this): ${productDescription}`
    : '';
  const ref = withReference ? `\n\n${STYLE_REFERENCE}` : '';
  // El director (Claude) reemplaza la escena fija del angulo; si no hay, cae al fijo.
  const scene = creativeDirection || angle.prompt;
  // El riel de produccion depende del modo: organico (iPhone) vs campaña (pulido).
  const look = styleMode === 'campaign' ? CAMPAIGN_LOOK : ANTI_AI;
  return `${GARMENT_LOCK}${back}${fitLock(fitSpec)}${desc}${ref}\n\n${scene}\n\n${BRAND_SAFE}${hookOverlay(hookSpec)}\n\n${look}`;
}
