import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { connectDb } from './db.js';
import { Creative } from './models/creative.js';
import { Carousel } from './models/carousel.js';
import { adAnglesRouter } from './routes/adAngles.js';
import { creativesRouter } from './routes/creatives.js';
import { productsRouter } from './routes/products.js';
import { referencesRouter } from './routes/references.js';
import { metaRouter } from './routes/meta.js';
import { carouselsRouter } from './routes/carousels.js';
import { autopilotRouter } from './routes/autopilot.js';
import { learningRouter } from './routes/learning.js';
import { startProductCron } from './sync.js';
import { startAutopilotCron } from './autopilot.js';
import { startMetricsCron } from './learning.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// Guardas: un error sin manejar en una generacion en background NO debe tirar el
// proceso (antes reiniciaba y mataba todos los jobs). Logueamos y seguimos.
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.message || err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err?.message || err));

const app = express();
app.use(express.json({ limit: '25mb' })); // base64 de imagenes (producto + referencia)

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', adAnglesRouter);
app.use('/api', creativesRouter);
app.use('/api', productsRouter);
app.use('/api', referencesRouter);
app.use('/api', metaRouter);
app.use('/api', carouselsRouter);
app.use('/api', autopilotRouter);
app.use('/api', learningRouter);

// Panel de QC (frontend estatico) servido por el mismo servicio -> sin CORS, un solo deploy.
app.use(express.static(publicDir));

// Barrido de huerfanos: si el server se reinicio a mitad de una generacion, esos
// docs quedan en 'generating' para siempre. Al arrancar los marcamos 'failed'.
async function sweepOrphans() {
  const c = await Creative.updateMany({ genStatus: 'generating' }, { $set: { genStatus: 'failed', genError: 'Interrumpido (reinicio del server)', fidelityStatus: 'failed' } });
  const k = await Carousel.updateMany({ genStatus: 'generating' }, { $set: { genStatus: 'failed', genError: 'Interrumpido (reinicio del server)', fidelityStatus: 'failed' } });
  if (c.modifiedCount || k.modifiedCount) console.log(`[sweep] huerfanos marcados failed: ${c.modifiedCount} creatives, ${k.modifiedCount} carruseles`);
}

async function start() {
  await connectDb();
  await sweepOrphans(); // limpia generaciones cortadas por reinicios
  startProductCron(); // sincroniza Shopify al arranque y cada N min
  startAutopilotCron(); // motor autonomo: genera el mix de productos pendientes
  startMetricsCron(); // sincroniza metricas de Meta -> tab Aprendizaje siempre fresco
  app.listen(config.port, () => {
    console.log(`[server] escuchando en :${config.port}`);
  });
}

start().catch((err) => {
  console.error('[server] fallo al arrancar:', err);
  process.exit(1);
});
