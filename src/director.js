import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

// Director creativo: Claude (claude-fable-5) inventa la DIRECCION CREATIVA de cada
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

ELEVATED STYLING IS THE POINT — the model must be EXQUISITELY DRESSED, never random:
- Build ONE cohesive, aspirational, on-trend fit around the shorts: considered layering (e.g. a clean zip hoodie over a tee, a boxy knit, a light jacket), a tonal/neutral or well-judged palette, ONE statement element, fresh STATEMENT sneakers, and subtle jewelry (a silver chain, rings). It should look styled by a brand, not thrown on.
- Quality over quirk: cream/bone/stone/charcoal tones read premium; avoid clashing, cheap or costumey looks.

YOU ALWAYS DESIGN THE OUTFIT. When a reference STYLE DNA is provided, treat it as INSPIRATION — match its vibe, caliber, the kinds of brands and the footwear/sneaker lane — but design a FRESH outfit, never a copy; vary the specific pieces so each fit is its own. When there is no DNA, design freely. Either way, follow the elevated-styling guidance below.

THE DENIM SHORTS ARE THE PRODUCT AND ARE SACRED. A separate system keeps them pixel-identical to a real photographed garment — that is what CAROTA sells, so fidelity to them is the #1 priority and your direction must protect it:
- NEVER describe, characterize, restyle, recolor or reshape the shorts in any way. Do NOT use words like baggy, oversized, ripped, distressed, faded, cropped, cuffed, long, short, light, dark — say NOTHING about the bottoms. Just leave clean room for them.
- The shorts must stay CLEARLY VISIBLE and well-lit: choose framing and a pose where the full lower body reads cleanly (no heavy crop at the thighs, no shorts hidden by bags/furniture/crossed legs/deep shadow/motion blur over the legs).
- Do NOT invent props, layering or poses that would tempt a renderer to re-interpret the bottoms.

CASTING: a young, good-looking male. The specific skin tone / ethnicity / vibe is given per shot below — ROTATE it across shots for a real, DIVERSE cast (fair, olive/Mediterranean, tanned brown "moreno", Latino, Black, mixed — they ALL look great in this fashion, the morenos and dark-skinned guys especially have a lot of pinta). VARY the vibe too: some clean-cut, others with visible tattoos and a cooler street/gangster edge — like the diverse people in the reference fitpics. Honor the given casting; don't otherwise describe the face in detail.

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
  organic: `STYLE: organic but ELEVATED & ASPIRATIONAL — a real, candid iPhone fitpic a stylish person posted (not an ad), with a genuinely great designer-streetwear fit (the caliber of Broken Planet, Represent, Corteiz, Essentials).
LIGHT: keep it CLEAN and BRIGHT with SOFT, EVEN, natural light — big window light, bright overcast, open shade, or clean coastal daylight. AVOID harsh direct sun, hard deep shadows, warm golden-hour / orange-yellow casts, and grungy dark or tan walls.
SETTING: honor EXACTLY the per-shot SETTING specified above (it rotates — coast, mirror-apartment, rooftop, street, interior, pool deck — so the feed is varied, not always the coast). Make that location feel real, aspirational and organic, like a stylish friend's fitpic, never a staged studio ad. If it is coastal, show real context (hillside town, villas, rooftops, coastline), never an empty flat sea.
THE SHORTS ARE THE HERO: compose and light so the DENIM SHORTS are the clear focal point — prominent, well-lit lower body, framed FAIRLY CLOSE so the model fills most of the frame. Do NOT add big handbags, luggage or busy props that steal attention from the shorts.`,
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
const CASTINGS = [
  'a fair / light-skinned European young man, clean look',
  'an olive-skinned Mediterranean young man',
  'a tanned brown-skinned (moreno) young man with a cool relaxed edge',
  'a moreno (brown-skinned Latino) young man with visible tattoos and a streetwear-gangster edge',
  'a Black / dark-skinned young man with a fresh clean look',
  'a Black / dark-skinned young man with tattoos and a confident street edge',
  'a Latino young man with light-brown skin and some tattoos',
  'a mixed-race young man with medium-brown skin',
  'a dark-skinned young man, athletic, with a bit of attitude',
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

// Escena rotativa: el director se fijaba SIEMPRE en la costa. Forzamos rotacion de
// locacion+pose para que mezcle de verdad (bahia / espejo / rooftop / calle / interior).
const SETTINGS = [
  'an aspirational COASTAL/RIVIERA terrace with REAL context behind him (a Mediterranean hillside town, pastel villas, terracotta rooftops, a marina, the coastline) under soft bright daylight. It is a candid shot TAKEN BY A FRIEND — both hands free, leaning on the stone balustrade or mid-stride, NO phone in hand.',
  'a MIRROR FITPIC inside a bright minimal apartment (white walls, pale oak floors, a full-length mirror leaning on the wall, soft window light). Here he DOES hold the phone up to the mirror — a real, logical mirror selfie.',
  'a clean modern ROOFTOP or balcony over a city skyline in soft daylight. Candid shot taken by a friend — hands free, relaxed stance, NO phone in hand.',
  'a calm, characterful CITY STREET (nice doorway, café front, brick or clean facade) in soft even light. Candid walking or leaning shot taken by a friend — NO phone in hand.',
  'a bright, airy INTERIOR — a stylish minimal apartment or a cool café with big soft window light and clean neutral tones. Candid shot, relaxed real pose, NO phone unless there is a mirror.',
  'a sunny POOL DECK / villa terrace with clean modern architecture and a sliver of sea or greenery, soft bright light. Candid shot by a friend — hands free, NO phone in hand.',
];
let setCounter = Math.floor(Math.random() * SETTINGS.length);
function nextSetting() {
  const s = SETTINGS[setCounter % SETTINGS.length];
  setCounter += 1;
  return s;
}

export async function directCreative({ product, wash, angle, refDna = '', seed = '', mode = 'single', styleMode = 'organic' }) {
  if (!client) return null;
  const intent = ANGLE_INTENT[angle] || ANGLE_INTENT.realista;
  const cast = nextCast();
  const setting = nextSetting();
  const modeBrief = MODE_BRIEF[styleMode] || MODE_BRIEF.organic;
  const styling = refDna
    ? `Design a fresh, cohesive, elevated outfit INSPIRED by this reference style DNA — match its vibe, caliber, the kinds of brands and the footwear/sneaker lane, but do NOT copy it: choose your own specific top/layers, footwear and accessories so this fit is its own (never the bottoms). Reference style DNA: ${refDna}`
    : 'YOU design the full elevated outfit yourself — the TOP and layering, the statement footwear, and accessories (never the bottoms).';
  const heroNote = mode === 'carouselHero'
    ? '\nThis is the HERO of a carousel and sets the look for the whole set, so keep the composition SIMPLE and clean: a fairly frontal full-body standing pose in SOFT, EVEN, BRIGHT light (a clean bright neutral setting — NOT harsh sun or warm walls), the full lower body unobstructed and clearly in frame, framed FAIRLY CLOSE so the model fills most of the frame (not small and distant). No motion blur, no busy foreground, no crop at the legs.'
    : '';
  const user = `Product: ${product || 'denim shorts'}${wash ? ` (wash: ${wash})` : ''}.
Angle to hit: ${intent}.
Casting for THIS shot: ${cast} — handsome, with a clean current streetwear look.
SETTING for THIS shot — use EXACTLY this location and shot type (do not default to the coast every time): ${setting}
${modeBrief}
${styling}${heroNote}
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
    // repite). Asi el color de piel / etnia rota de verdad foto a foto.
    return `${text}\n\nThe model is ${cast}.`;
  } catch (err) {
    console.error('[director] fallo, uso prompt fijo:', err.message);
    return null;
  }
}
