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

HARD RULES:
- The denim shorts are a FIXED product handled elsewhere. Do NOT describe, restyle, recolor or change the shorts. Never mention their wash, rips, length or fit. Just leave room for them.
- Never describe a face/identity in detail.
- Stay achievable for a real iPhone photo: real locations, real available light, candid framing. No studio, no fantasy, no text overlays, no props that look staged.
- Be CONCRETE and varied: pick a specific location, time of day, pose/action, mood and (when asked) outfit styling around the shorts. Avoid generic "young man in an urban setting" — make it feel like a real moment.

OUTPUT: ONLY 2-3 sentences of vivid art direction. No preamble, no labels, no quotes.`;

const ANGLE_INTENT = {
  realista: 'a low-key candid fitpic that reads as organic social content, relaxed everyday energy',
  realismo_completo: 'maximum-realism snapshot, unmistakably a real phone photo, fine grain and real texture',
  gancho_click: 'a hero moment built to stop the scroll on the first frame — attitude, energy, micro-motion',
  llamada_atencion: 'high-impact, reads as a fresh drop — bold real backdrop, striking but still a real photo',
};

// Devuelve una direccion creativa (string) o null si no hay key / falla (cae al fijo).
export async function directCreative({ product, wash, angle, withReference, seed = '' }) {
  if (!client) return null;
  const intent = ANGLE_INTENT[angle] || ANGLE_INTENT.realista;
  const styling = withReference
    ? 'A Pinterest STYLE REFERENCE will supply the outfit, footwear and overall vibe — so focus on the SCENE, pose, light, mood and framing, and keep the outfit open for the reference (mention at most a loose silhouette).'
    : 'There is NO style reference, so YOU also choose the outfit styling around the shorts: the top/jacket, the footwear/sneakers and accessories, worn naturally.';
  const user = `Product: ${product || 'denim shorts'}${wash ? ` (wash: ${wash})` : ''}.
Angle to hit: ${intent}.
${styling}
Invent a fresh direction that feels different from generic streetwear stock — vary the location, time of day, pose and energy.${seed ? ` Creative seed to push somewhere new: ${seed}.` : ''}`;

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
