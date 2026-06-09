import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { connectDb } from './db.js';
import { adAnglesRouter } from './routes/adAngles.js';
import { creativesRouter } from './routes/creatives.js';
import { productsRouter } from './routes/products.js';
import { referencesRouter } from './routes/references.js';
import { metaRouter } from './routes/meta.js';
import { carouselsRouter } from './routes/carousels.js';
import { startProductCron } from './sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '25mb' })); // base64 de imagenes (producto + referencia)

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', adAnglesRouter);
app.use('/api', creativesRouter);
app.use('/api', productsRouter);
app.use('/api', referencesRouter);
app.use('/api', metaRouter);
app.use('/api', carouselsRouter);

// Panel de QC (frontend estatico) servido por el mismo servicio -> sin CORS, un solo deploy.
app.use(express.static(publicDir));

async function start() {
  await connectDb();
  startProductCron(); // sincroniza Shopify al arranque y cada N min
  app.listen(config.port, () => {
    console.log(`[server] escuchando en :${config.port}`);
  });
}

start().catch((err) => {
  console.error('[server] fallo al arrancar:', err);
  process.exit(1);
});
