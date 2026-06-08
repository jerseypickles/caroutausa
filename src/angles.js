// Los prompts viven SOLO en este archivo. La estructura importa mas que el
// texto exacto: cada angulo = garment lock + escena/modelo/luz/mood.

// Bloquea el producto: el modelo solo cambia escena, no rediseña el garment.
export const GARMENT_LOCK = `Keep the exact garment from the source image unchanged:
same denim wash, same distressing and rips, same stitching,
same hardware and any chains, same cut and fit.
Do not redesign the product. Only change the scene, model,
styling, light and mood as described below.`;

// Anti-IA: se concatena a cada prompt para empujar realismo y matar tells.
const ANTI_AI = `Photoreal, shot on a real camera, real available light with real shadows.
Natural skin with visible pores and slight grain, no waxy or plastic skin,
no over-smoothing, no perfect symmetry, no uniform HDR glow.
Slightly muted real white balance, not oversaturated. Real cluttered environment with texture.`;

// Referencia de estilo (imagen 2): copiar outfit/zapatillas/vibe, NO el bottom ni la cara.
const STYLE_REFERENCE = `Use the SECOND image only as a STYLING reference. Copy from it:
the outfit pieces (top, jacket, footwear/sneakers), how the clothes are worn,
the accessories, the overall fashion vibe, color mood and photographic style.
Do NOT copy the pants/shorts from the second image — the bottoms must stay the
EXACT garment from the first image. Do NOT copy the face or identity from the
second image; use a different real model.`;

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
    prompt: `Maximum photographic realism. Editorial-grade but unmistakably real photo.
Visible film-like grain, real lens character, real fabric texture on the denim.
Golden hour or overcast daylight with directional real shadows.`,
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

// Arma el prompt final para un angulo: garment lock + (referencia) + escena + anti-IA.
export function buildPrompt(angleId, { withReference = false } = {}) {
  const angle = ANGLES[angleId];
  if (!angle) {
    throw new Error(`Angulo desconocido: ${angleId}. Validos: ${Object.keys(ANGLES).join(', ')}`);
  }
  const ref = withReference ? `\n\n${STYLE_REFERENCE}` : '';
  return `${GARMENT_LOCK}${ref}\n\n${angle.prompt}\n\n${ANTI_AI}`;
}
