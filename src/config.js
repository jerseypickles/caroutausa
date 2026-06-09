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
  // Tienda Shopify (para el link de destino de los ads)
  storeUrl: process.env.STORE_URL || 'https://carotaus.com',
  // Meta Marketing API (valores en Render). Opcional: el server arranca sin esto.
  meta: {
    graphVersion: process.env.META_GRAPH_VERSION || 'v23.0',
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    accessToken: process.env.META_ACCESS_TOKEN || '',
    adAccountId: process.env.META_AD_ACCOUNT_ID || '',
    pageId: process.env.META_PAGE_ID || '',
    pixelId: process.env.META_PIXEL_ID || '',
  },
};
