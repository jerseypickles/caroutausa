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
};
