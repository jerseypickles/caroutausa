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

OTHER RULES:
- Never describe a face/identity in detail.
- No fantasy, no text overlays, no costumey props. Keep it a real, fresh moment with great taste.
- Be CONCRETE and varied: specific location, time of day, pose, mood, and the elevated outfit styling for the TOP, footwear and accessories. Avoid generic "young man in an urban setting" and avoid laundromats.

OUTPUT: 2-5 sentences of vivid, specific art direction (richer and more detailed for campaign looks; describe the outfit head-to-toe). No preamble, no labels, no quotes.`;

// Produccion segun el modo: organico (fitpic iPhone elevado) o campaña (shoot pulido).
const MODE_BRIEF = {
  organic: 'STYLE: organic but elevated — looks like a real, candid iPhone fitpic a stylish person posted (not an ad), but with a genuinely great outfit. Real aspirational-everyday location (clean apartment, nice rooftop, cool café, city street with character), real available light, slightly casual framing.',
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
export async function directCreative({ product, wash, angle, refDna = '', seed = '', mode = 'single', styleMode = 'organic' }) {
  if (!client) return null;
  const intent = ANGLE_INTENT[angle] || ANGLE_INTENT.realista;
  const modeBrief = MODE_BRIEF[styleMode] || MODE_BRIEF.organic;
  const styling = refDna
    ? `Design a fresh, cohesive, elevated outfit INSPIRED by this reference style DNA — match its vibe, caliber, the kinds of brands and the footwear/sneaker lane, but do NOT copy it: choose your own specific top/layers, footwear and accessories so this fit is its own (never the bottoms). Reference style DNA: ${refDna}`
    : 'YOU design the full elevated outfit yourself — the TOP and layering, the statement footwear, and accessories (never the bottoms).';
  const heroNote = mode === 'carouselHero'
    ? '\nThis is the HERO of a carousel and sets the look for the whole set, so keep the composition SIMPLE and clean: a fairly frontal, full-body standing pose in calm even light, the full lower body unobstructed and clearly in frame. No motion blur, no busy foreground, no crop at the legs.'
    : '';
  const user = `Product: ${product || 'denim shorts'}${wash ? ` (wash: ${wash})` : ''}.
Angle to hit: ${intent}.
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
    return text || null;
  } catch (err) {
    console.error('[director] fallo, uso prompt fijo:', err.message);
    return null;
  }
}
