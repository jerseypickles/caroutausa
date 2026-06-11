import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} (revisa tu .env, ver .env.example)`);
  }
  return value;
}

export const config = {
  port: process.env.PORT || 3000,
  openaiApiKey: required('OPENAI_API_KEY'),
  mongoUri: required('MONGODB_URI'),
  imageModel: process.env.IMAGE_MODEL || 'gpt-image-2',
  realismPass: process.env.REALISM_PASS !== 'false', // pase de grano/tono organico (default ON)
  hookAuto: process.env.HOOK_AUTO !== 'false', // genera la variante con hook auto en cada creativo (default ON)
  judgeModel: process.env.JUDGE_MODEL || 'gpt-5.1',
  // Director creativo (Anthropic): genera los prompts de imagen dinamicamente.
  // Las imagenes las sigue haciendo gpt-image. Opcional: sin key, cae al prompt fijo.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  directorModel: process.env.DIRECTOR_MODEL || 'claude-fable-5',
  fidelityPass: Number(process.env.FIDELITY_PASS || 85), // umbral de aprobado (diseño)
  fitPass: Number(process.env.FIT_PASS || 75), // umbral de aprobado (silueta/fit)
  // receta mixta por producto: por cada angulo, 1 variante SIN referencia (jean
  // garantizado) + 1 CON referencia (vibe, gated por el juez).
  recipeAngles: (process.env.RECIPE_ANGLES || 'realista,gancho_click').split(',').map((s) => s.trim()).filter(Boolean),
  // reintentos automaticos cuando el juez marca fail (aprovecha la varianza de la ref)
  fidelityRetries: Number(process.env.FIDELITY_RETRIES || 1),
  syncIntervalMin: Number(process.env.SYNC_INTERVAL_MIN || 10),
  // Motor autonomo: genera solo el mix de los productos pendientes.
  autopilotEnabled: process.env.AUTOPILOT_ENABLED !== 'false', // default ON
  autopilotIntervalMin: Number(process.env.AUTOPILOT_INTERVAL_MIN || 30),
  autopilotTarget: Number(process.env.AUTOPILOT_TARGET || 8), // creatives por producto antes de parar
  // Tienda Shopify (para el link de destino de los ads)
  storeUrl: process.env.STORE_URL || 'https://carotaus.com',
  // Promo que se agrega al copy de CADA ad al lanzar (cambialo cuando cambie la oferta).
  // Poné META_PROMO='' (vacío) para no agregar nada.
  metaPromo: process.env.META_PROMO != null ? process.env.META_PROMO : '🔥 25% OFF con el código SUMMER25',
  // Meta Marketing API (valores en Render). Opcional: el server arranca sin esto.
  meta: {
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    accessToken: process.env.META_ACCESS_TOKEN || '',
    adAccountId: process.env.META_AD_ACCOUNT_ID || '',
    pageId: process.env.META_PAGE_ID || '',
    pixelId: process.env.META_PIXEL_ID || '',
    igAccountId: process.env.META_IG_ID || '17841467985665979', // cuenta IG @carotausa (para placements de IG)
  },
};
