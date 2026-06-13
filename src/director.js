import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

// Director creativo: Claude (claude-opus-4-8) inventa la DIRECCION CREATIVA de cada
// fitpic — escena, pose, mood, styling, luz, encuadre — para que cada creative
// explore algo distinto (mas diversidad = mas para aprender en Meta). Las imagenes
// las genera gpt-image; el jean (garment lock) y el look anti-IA siguen siendo
// rieles fijos en angles.js. El director NO toca el jean.
const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

export function directorEnabled() {
  return Boolean(client);
}

const SYSTEM = `You are the creative director for CAROTA, a US streetwear brand whose product is denim shorts. Think at the level of a real brand campaign (à la Lorenzo, Represent, Fear of God Essentials).
Your job: invent ONE fresh, specific creative direction for a SINGLE paid-social ad (Meta Reels/Feed) for a young US streetwear audience.

ELEVATED STYLING IS THE POINT — the model must be EXQUISITELY DRESSED, never random, and VARIED across shots:
- SILHOUETTE / FIT — FOLLOW THE REFERENCE (this is what makes it look pro and on-trend, and drives CTR): match the silhouette and fit of the REFERENCE outfit. If the reference's top is FITTED / slim, make it fitted; if it is OVERSIZED / boxy / baggy, make it oversized. Honor the reference's proportions exactly — do NOT impose a different fit. (Only when there is NO reference, default to a current relaxed streetwear fit.) The fit is a key part of the look, so respect what the reference shows.
- Build ONE cohesive, aspirational, on-trend fit around the shorts. VARY it hard shot to shot — do NOT default to a plain cream tee every time. Mix it up: oversized hoodies (zip or pullover), boxy knits, jerseys, graphic-ish tees, varsity/work jackets, vests, layered pieces.
- VARY THE COLOR PALETTE boldly: not always cream/beige. Use real streetwear color — washed black, faded reds, forest/olive green, navy, brown, burgundy, mustard, grey, the occasional bold pop. Tonal looks are fine sometimes, but the FEED must look colorful and diverse overall, not monochrome cream.
- ACCESSORIES matter A LOT (this is streetwear): rotate and STACK them like the reference fitpics — a fitted cap or beanie (often backwards), a gold or silver watch, LAYERED gold/silver chains, rings on multiple fingers, sunglasses, and a wallet chain clipped to a belt loop. A CROSSBODY / SLING BAG worn across the chest is a signature of this look — include it FREQUENTLY, ideally in a BOLD POP COLOR (red, etc.) against a neutral fit (like the reference fitpics that carry one). Small bags only, never big luggage, and never covering the shorts. Real, current, flexed.
- LAYERING like the reference: e.g. an open washed-black zip hoodie over a white ribbed tank, leg/arm tattoos showing. Aim for that elevated-but-street energy.
- SNEAKERS = COPY THE REFERENCE: put the EXACT sneakers the reference DNA names (match the model AND colorway — e.g. DNA says "Balenciaga Triple S black/white" -> chunky black/white dad-runners; "ASICS gel runners" -> those; "Sambas" -> Sambas). Real, current sneakers are ENCOURAGED. Do NOT default to white Air Force 1s or Jordans unless the reference actually has them — that is the #1 mistake to avoid.
- Quality over quirk: it should look styled by a brand and current to the culture, never clashing, cheap or costumey.
- GRAPHIC TOPS (NOT blank!): the TOP should OFTEN carry a BOLD, ORIGINAL graphic / art print / illustration — a real streetwear graphic tee or hoodie (a big front graphic, a photo-collage, an illustrated character, an art print, a striking image — like the reference fitpics). Do NOT default to plain blank tops; blanks are boring and look cheap. Make the graphic interesting and current. BUT it must be ORIGINAL/generic art that could be CAROTA's own — NEVER a recognizable third-party BRAND logo, wordmark or brand name (no Stüssy, Supreme, Nike, BBC, Icecream, Broken Planet, Pleasures, Corteiz, Carhartt, Fear of God, Hellstar, etc.). Cool design YES, someone else's brand NO. Keep the brand attention on CAROTA. (Real sneakers on-foot are fine.) The graphic text/art must ALWAYS be FORWARD and clearly READABLE — NEVER mirrored, reversed, backwards or upside-down (even if the reference is a mirror selfie where its text looks flipped — render it the right way around).

When a reference STYLE DNA is provided, FOLLOW IT STRICTLY — REPRODUCE the look closely, do NOT improvise a different outfit. Match, as faithfully as you can: the SAME garment types (tee vs hoodie vs jacket), the SAME graphic STYLE and layout on the top, the EXACT sneakers (model + colorway), the SAME fit / silhouette (cropped / boxy / oversized / baggy), the SAME accessories (cap, chains, bag, etc.) and the SAME pose energy. The ONLY two things you are allowed to change: (1) the COLOR palette — recolor the fit so it is not a pixel-for-pixel copy, and (2) swap any recognizable third-party brand WORDMARK / logo on the TOP for ORIGINAL text or art in the SAME visual style (brand-safe). NEVER change the bottoms — it is always the CAROTA denim short. The result must clearly read as the SAME outfit/look as the reference, just recolored and brand-safe — NOT a loosely-inspired different fit. When there is NO reference DNA, design freely per the guidance below.

THE DENIM SHORTS ARE THE PRODUCT AND ARE SACRED. A separate system keeps them pixel-identical to a real photographed garment — that is what CAROTA sells, so fidelity to them is the #1 priority and your direction must protect it:
- NEVER describe, characterize, restyle, recolor or reshape the shorts in any way. Do NOT use words like baggy, oversized, ripped, distressed, faded, cropped, cuffed, long, short, light, dark — say NOTHING about the bottoms. Just leave clean room for them.
- The shorts must stay CLEARLY VISIBLE and well-lit: choose framing and a pose where the full lower body reads cleanly (no heavy crop at the thighs, no shorts hidden by bags/furniture/crossed legs/deep shadow/motion blur over the legs).
- Do NOT invent props, layering or poses that would tempt a renderer to re-interpret the bottoms.

CASTING: a young, good-looking male. The exact skin tone / ethnicity / tattoos / vibe is GIVEN per shot below — honor it EXACTLY. CAROTA's market is young urban streetwear, which skews MORENO (brown-skinned), BLACK and LATINO, MANY with visible tattoos and a street/gangster edge — that is the look that sets the trends, so it dominates the cast. CRITICAL: render the given dark/brown skin tone FAITHFULLY (do NOT lighten, whitewash or default to a generic light-skinned model) and KEEP the specified tattoos visible. Don't otherwise describe the face in detail.

POSE & SHOT LOGIC — be intelligent and coherent, the pose MUST fit the scene:
- A "holding the phone up to take the photo" mirror-selfie pose is ONLY allowed when the scene literally has a MIRROR (e.g. inside an apartment with a leaning mirror). NEVER use a phone-held-up pose outdoors or anywhere without a mirror — with no mirror it looks absurd, like an invisible mirror.
- In any OUTDOOR or mirror-less setting, it is a candid photo TAKEN BY A FRIEND: both hands free and natural (in pockets, adjusting the cap, at his sides), a relaxed real-person stance — walking, leaning on a railing, looking off to the side — NO phone in hand.
- Vary the pose and the shot each time; make it feel dynamic and real, never the same stiff stance.

OTHER RULES:
- No fantasy, no text overlays, no costumey props. Keep it a real, fresh moment with great taste.
- Be CONCRETE and varied: specific location, time of day, pose, mood, and the elevated outfit styling for the TOP, footwear and accessories. Avoid generic "young man in an urban setting" and avoid laundromats.

OUTPUT: 2-5 sentences of vivid, specific art direction (richer and more detailed for campaign looks; describe the outfit head-to-toe). No preamble, no labels, no quotes.`;

// Produccion segun el modo: organico (fitpic iPhone elevado) o campaña (shoot pulido).
const MODE_BRIEF = {
  organic: `STYLE: organic but ELEVATED — a real, candid iPhone fitpic a stylish person posted (not an ad), with a genuinely great designer-streetwear fit (caliber of Broken Planet, Represent, Corteiz, Essentials, Hellstar).
LIGHT: the shorts must stay clearly VISIBLE and legible, but VARY the mood across shots — clean bright window light, OR moody overcast, OR warm golden city light, OR cool neon/dusk glow. Avoid only: blowing out detail or hiding the lower body in deep shadow/blur. Some grit and real texture is GOOD.
SETTING: honor EXACTLY the per-shot SETTING specified above (it rotates across many vibes — coast, mirror-apartment, graffiti wall, basketball court, parking garage, rooftop, bodega, street, loft, pool deck — so the feed is DIVERSE, never the same place twice). Make it feel real and organic, like a stylish friend's fitpic, never a staged studio ad.
THE SHORTS ARE THE HERO: compose so the DENIM SHORTS are the clear focal point — prominent, well-lit lower body, framed FAIRLY CLOSE so the model fills most of the frame. A small crossbody bag worn on the chest is great styling; just never let a bag, prop or pose cover or hide the shorts.`,
  campaign: `STYLE: a REAL high-end brand campaign at the caliber of Lorenzo Worldwide — editorial, aspirational, photographed (not a render). Describe the look HEAD TO TOE with SPECIFIC, real, nameable pieces and materials so it renders with true detail:
- the exact TOP and layering: garment type, cut, fabric and how it sits (e.g. "an open boxy cream heavyweight zip-hoodie with drawcords over a tonal-print tee");
- the accessories: a specific chain (e.g. silver Cuban link), rings, any hair detail;
- and especially the SNEAKERS: a specific silhouette + colorway and material (e.g. "cream chunky leather low-tops").
Place it in a scenic, aspirational location (a Mediterranean stone balustrade over a yacht harbor, a rooftop in clean daylight, modern architecture, a coastal terrace), full-body frontal composition, a confident relaxed pose, and beautiful real natural light. Specify the light direction and mood like a photographer would.`,
};

const ANGLE_INTENT = {
  realista: 'a low-key candid fitpic that reads as organic social content, relaxed everyday energy',
  realismo_completo: 'maximum-realism snapshot, unmistakably a real phone photo, fine grain and real texture',
  gancho_click: 'a hero moment built to stop the scroll on the first frame — attitude, energy, micro-motion',
  llamada_atencion: 'high-impact, reads as a fresh drop — bold real backdrop, striking but still a real photo',
};

// Devuelve una direccion creativa (string) o null si no hay key / falla (cae al fijo).
// mode 'carouselHero' = escena mas simple y encuadre frontal claro (el hero define
// todo el set; si driftea el jean, arrastra a las cards encadenadas).
// Casting rotativo: cada foto un color de piel / etnia / onda distinto (variedad real,
// como la gente del tab de Referencias). Peso hacia morenos / piel oscura + algunos con
// tatuajes y onda mas street/gangster, otros mas clean.
// Cada casting con un TAG corto (para etiquetar el creativo y poder aprender qué rinde).
// Lista PESADA hacia el market real de CAROTA: morenos, negros y latinos, MUCHOS con
// tatuajes y onda street/gangster (los morenos imponen moda en lo juvenil). Los claros
// son raros. Tags repetidos a propósito = peso en la rotación (el learning agrupa por tag).
const CASTINGS = [
  { tag: 'moreno-ink', desc: 'a brown-skinned (moreno) young man with FULL sleeve tattoos and a cool street/gangster edge, curls or a low fade, silver chains' },
  { tag: 'black-ink', desc: 'a dark-skinned Black young man with neck and arm tattoos, dreads or a fresh fade, confident street energy' },
  { tag: 'moreno', desc: 'a tanned brown-skinned (moreno) young man, relaxed cool, some tattoos, modern street haircut' },
  { tag: 'latino-ink', desc: 'a Latino young man with light-brown skin, hand and arm tattoos, slicked or curly hair, gangster-chic energy' },
  { tag: 'black', desc: 'a dark-skinned Black young man, clean fresh look, athletic, sharp lineup' },
  { tag: 'moreno-ink', desc: 'a moreno young man covered in tattoos, durag or buzz cut, hard street attitude' },
  { tag: 'mixed', desc: 'a mixed-race young man with medium-brown skin, textured curls, a few tattoos' },
  { tag: 'black-ink', desc: 'a very dark-skinned Black young man with bold tattoos, twists or braids, magnetic street presence' },
  { tag: 'moreno', desc: 'a moreno young man, sun-kissed brown skin, effortless cool, gold jewelry' },
  { tag: 'dark-athletic', desc: 'a dark-skinned athletic young man with attitude and visible tattoos' },
  { tag: 'olive', desc: 'an olive-skinned Mediterranean/Latino young man, light stubble, some ink' },
  { tag: 'fair', desc: 'a light-skinned young man with tattoos and a gritty street edge (rare in the mix)' },
];

// Round-robin (no al azar): cada generacion agarra el SIGUIENTE casting -> dos fotos
// de una misma tanda NUNCA repiten tono de piel; con el tiempo recorre todos los tipos.
// Arranca en un punto aleatorio para no empezar siempre por el mismo.
let castCounter = Math.floor(Math.random() * CASTINGS.length);
function nextCast() {
  const c = CASTINGS[castCounter % CASTINGS.length];
  castCounter += 1;
  return c;
}

// Escena rotativa (con TAG) — el director se fijaba SIEMPRE en la costa. Forzamos
// rotacion de locacion+pose para que mezcle de verdad y poder aprender qué escena gana.
const SETTINGS = [
  { tag: 'coast', desc: 'an aspirational COASTAL/RIVIERA terrace with REAL context behind him (a Mediterranean hillside town, pastel villas, terracotta rooftops, a marina, the coastline). Candid shot TAKEN BY A FRIEND — hands free, leaning on the balustrade or mid-stride, NO phone in hand.' },
  { tag: 'mirror-apt', desc: 'a MIRROR FITPIC inside a stylish apartment (a full-length mirror leaning on the wall, real lived-in decor, window light). He DOES hold the phone up to the mirror — a real, logical mirror selfie.' },
  { tag: 'graffiti', desc: 'a gritty urban wall covered in colorful GRAFFITI / a mural, raw street culture vibe, bold colors behind him. Candid shot by a friend — hands free, attitude in the stance, NO phone in hand.' },
  { tag: 'court', desc: 'an outdoor BASKETBALL COURT (chain-link fence, painted lines, city behind). Candid street shot — leaning on the fence or mid-stride, NO phone in hand.' },
  { tag: 'garage', desc: 'a concrete PARKING GARAGE / underground with moody overhead light and a clean car nearby, cinematic street energy. Candid shot by a friend — NO phone in hand.' },
  { tag: 'rooftop', desc: 'a modern ROOFTOP over a city skyline, golden-hour or moody dusk light, neon glow from the city. Candid shot by a friend — relaxed stance, NO phone in hand.' },
  { tag: 'bodega', desc: 'outside a NYC-style BODEGA / corner store at night, warm storefront and neon signage glow, classic street culture. Candid shot by a friend — NO phone in hand.' },
  { tag: 'street', desc: 'a characterful CITY STREET (brownstone stoop, café front, brick) with real grit and texture. Candid walking or leaning shot by a friend — NO phone in hand.' },
  { tag: 'loft', desc: 'an industrial LOFT / studio — exposed brick, concrete, big windows, raw creative-space vibe. Candid shot, relaxed real pose, NO phone unless there is a mirror.' },
  { tag: 'pooldeck', desc: 'a POOL DECK / villa terrace with modern architecture and a sliver of sea or palms, warm light. Candid shot by a friend — hands free, NO phone in hand.' },
];
let setCounter = Math.floor(Math.random() * SETTINGS.length);
function nextSetting() {
  const s = SETTINGS[setCounter % SETTINGS.length];
  setCounter += 1;
  return s;
}

export async function directCreative({ product, wash, angle, refDna = '', sceneDna = '', poseDna = '', seed = '', mode = 'single', styleMode = 'organic' }) {
  if (!client) return null;
  const intent = ANGLE_INTENT[angle] || ANGLE_INTENT.realista;
  const cast = nextCast();
  // Escena: si hay una REFERENCIA de escena, la usamos como locacion; si no, rota la lista fija.
  let settingDesc, sceneTag;
  if (sceneDna) { settingDesc = `${sceneDna} (recreate a similar real location/light, NOT a copy; never the product or the person's face)`; sceneTag = 'ref-scene'; }
  else { const s = nextSetting(); settingDesc = s.desc; sceneTag = s.tag; }
  // Pose: si hay una REFERENCIA de pose, la usamos como base (adaptada a la escena/lógica).
  const poseNote = poseDna ? `\nPOSE inspiration from a reference (use this stance/energy/framing, ADAPTED so it fits the scene and the pose logic above — keep the full lower body visible): ${poseDna}` : '';
  const modeBrief = MODE_BRIEF[styleMode] || MODE_BRIEF.organic;
  const styling = refDna
    ? `REPRODUCE this reference look as FAITHFULLY as possible (do NOT design a different outfit). Match it CLOSELY: the SAME garment types, the SAME graphic style, the EXACT sneakers (model + colorway named in the DNA — e.g. "Balenciaga Triple S black/white" = chunky black/white dad-runners, NOT Air Force 1s), the SAME fit/silhouette (cropped/boxy/oversized/baggy — match the proportions), the SAME accessories and pose energy. You may ONLY change: (1) the COLOR palette (recolor so it is not a pixel copy), and (2) any third-party brand wordmark on the top -> original text/art in the SAME style. NEVER the bottoms (CAROTA short).
TOP GRAPHIC: reproduce the reference graphic's STYLE and layout closely — same typography style (bold sans slogan / gothic / script / collage / character), same placement and scale — but make the WORDS/art ORIGINAL (not the exact brand wordmark). The text/art must be FORWARD and clearly READABLE — NEVER mirrored, reversed or backwards, even if the reference is a mirror selfie. It must be ORIGINAL/generic, never a recognizable THIRD-PARTY brand logo (no Stüssy, Supreme, Nike, BBC, Pleasures, Carhartt, Hellstar, etc.). Reference style DNA: ${refDna}`
    : 'YOU design the full elevated outfit yourself — the TOP and layering (give the top a bold ORIGINAL graphic, not blank), the statement footwear, and accessories (never the bottoms). The TOP graphic must be original, NEVER a recognizable third-party brand logo/wordmark.';
  const heroNote = mode === 'carouselHero'
    ? '\nThis is the HERO of a carousel and sets the look for the whole set, so keep the composition SIMPLE and clean: a fairly frontal full-body standing pose in SOFT, EVEN, BRIGHT light (a clean bright neutral setting — NOT harsh sun or warm walls), the full lower body unobstructed and clearly in frame, framed FAIRLY CLOSE so the model fills most of the frame (not small and distant). No motion blur, no busy foreground, no crop at the legs.'
    : mode === 'video'
    ? `\nVIDEO-READY LOWER-BODY FIT-CHECK (this still will be ANIMATED and the PRODUCT is the WHOLE subject): frame the shot VERTICALLY from about the WAIST / lower torso DOWN to the FEET — the chest, arms, head and face are ABOVE the frame, OUT of shot. The DENIM SHORTS, legs and sneakers FILL the entire frame: large, centered, sharp, well lit — a tight lower-body "fit check" where the shorts are the only focus. Shoot it at full resolution from this close framing natively (do NOT show a small full-body figure in a big room). A clean minimal room (bedroom / apartment), wood floor, soft natural daylight, just a little visible behind for depth. The model stands still, weight even; maybe one hand resting near the waistband or pocket. Real phone fit-check energy.
SHORTS LENGTH IS CRITICAL: the denim shorts must end EXACTLY AT THE KNEE, identical to the product photo — never longer / below the knee. Keep the exact wash, raw frayed hem, width and knee length of the product.`
    : '';
  const user = `Product: ${product || 'denim shorts'}${wash ? ` (wash: ${wash})` : ''}.
Angle to hit: ${intent}.
Casting for THIS shot: ${cast.desc} — handsome, with a clean current streetwear look.
SETTING for THIS shot — use EXACTLY this location and shot type (do not default to the coast every time): ${settingDesc}
${modeBrief}
${styling}${poseNote}${heroNote}
Invent a fresh, well-styled direction that feels like a real brand campaign — vary the location, time of day, pose and energy.${seed ? ` Creative seed to push somewhere new: ${seed}.` : ''}
Remember: say NOTHING about the shorts and keep the lower body clearly visible.`;

  try {
    const msg = await client.messages.create({
      model: config.directorModel,
      max_tokens: styleMode === 'campaign' ? 600 : 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) return null;
    // Garantizamos el casting en lo que llega a gpt-image (el director no siempre lo
    // repite). Devolvemos tambien los TAGS (escena + casting) para etiquetar el creativo.
    return { text: `${text}\n\nThe model is ${cast.desc}.`, castTag: cast.tag, sceneTag };
  } catch (err) {
    console.error('[director] fallo, uso prompt fijo:', err.message);
    return null;
  }
}
