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
  fidelityPass: Number(process.env.FIDELITY_PASS || 85), // umbral de aprobado
  // receta de generacion por producto: 2 angulos x 2 referencias activas = 4 variantes
  recipeAngles: (process.env.RECIPE_ANGLES || 'realista,gancho_click').split(',').map((s) => s.trim()).filter(Boolean),
  recipeRefs: Number(process.env.RECIPE_REFS || 2),
  syncIntervalMin: Number(process.env.SYNC_INTERVAL_MIN || 10),
};
