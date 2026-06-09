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

const SYSTEM = `You are the creative director for CAROTA, a US streetwear brand whose product is denim shorts.
Your job: invent ONE fresh, specific creative direction for a SINGLE candid organic iPhone fitpic that will be a paid-social ad (Meta Reels/Feed) for a young US streetwear audience. CAROTA's edge is ORGANIC realism — it must look like a real fitpic a real person would post, NOT a studio ad.

THE DENIM SHORTS ARE THE PRODUCT AND ARE SACRED. A separate system keeps them pixel-identical to a real photographed garment — that is what CAROTA sells, so fidelity to them is the #1 priority and your direction must protect it:
- NEVER describe, characterize, restyle, recolor or reshape the shorts in any way. Do NOT use words like baggy, oversized, ripped, distressed, faded, cropped, cuffed, long, short, light, dark — say NOTHING about the bottoms. Just leave clean room for them.
- The shorts must stay CLEARLY VISIBLE and well-lit: choose framing and a pose where the full lower body reads cleanly (no heavy crop at the thighs, no shorts hidden by bags/furniture/crossed legs/deep shadow/motion blur over the legs).
- Do NOT invent props, layering or poses that would tempt a renderer to re-interpret the bottoms.

OTHER RULES:
- Never describe a face/identity in detail.
- Stay achievable for a real iPhone photo: real locations, real available light, candid framing. No studio, no fantasy, no text overlays, no props that look staged.
- Be CONCRETE and varied: pick a specific location, time of day, pose/action, mood and (when asked) outfit styling for the TOP and footwear. Avoid generic "young man in an urban setting" and avoid defaulting to laundromats — make it feel like a real, fresh moment.

OUTPUT: ONLY 2-3 sentences of vivid art direction. No preamble, no labels, no quotes.`;

const ANGLE_INTENT = {
  realista: 'a low-key candid fitpic that reads as organic social content, relaxed everyday energy',
  realismo_completo: 'maximum-realism snapshot, unmistakably a real phone photo, fine grain and real texture',
  gancho_click: 'a hero moment built to stop the scroll on the first frame — attitude, energy, micro-motion',
  llamada_atencion: 'high-impact, reads as a fresh drop — bold real backdrop, striking but still a real photo',
};

// Devuelve una direccion creativa (string) o null si no hay key / falla (cae al fijo).
// mode 'carouselHero' = escena mas simple y encuadre frontal claro (el hero define
// todo el set; si driftea el jean, arrastra a las cards encadenadas).
export async function directCreative({ product, wash, angle, withReference, seed = '', mode = 'single' }) {
  if (!client) return null;
  const intent = ANGLE_INTENT[angle] || ANGLE_INTENT.realista;
  const styling = withReference
    ? 'A Pinterest STYLE REFERENCE will supply the outfit, footwear and overall vibe — so focus on the SCENE, pose, light, mood and framing, and keep the outfit open for the reference (mention at most a loose silhouette for the TOP only).'
    : 'There is NO style reference, so YOU also choose the styling of the TOP and footwear/accessories (never the bottoms), worn naturally.';
  const heroNote = mode === 'carouselHero'
    ? '\nThis is the HERO of a carousel and sets the look for the whole set, so keep the composition SIMPLE and clean: a fairly frontal, full-body standing pose in calm even light, the full lower body unobstructed and clearly in frame. No motion blur, no busy foreground, no crop at the legs — clarity over drama.'
    : '';
  const user = `Product: ${product || 'denim shorts'}${wash ? ` (wash: ${wash})` : ''}.
Angle to hit: ${intent}.
${styling}${heroNote}
Invent a fresh direction that feels different from generic streetwear stock — vary the location, time of day, pose and energy.${seed ? ` Creative seed to push somewhere new: ${seed}.` : ''}
Remember: say NOTHING about the shorts and keep the lower body clearly visible.`;

  try {
    const msg = await client.messages.create({
      model: config.directorModel,
      max_tokens: 400,
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
