import { Router } from 'express';
import { Activity } from '../models/activity.js';
import { Product } from '../models/product.js';
import { Creative } from '../models/creative.js';
import { runAutopilot } from '../autopilot.js';
import { config } from '../config.js';

export const autopilotRouter = Router();

// GET /api/activity -> feed de progreso (lo que va desarrollando el motor)
autopilotRouter.get('/activity', async (_req, res) => {
  const items = await Activity.find().sort({ createdAt: -1 }).limit(60).lean();
  res.json({ activity: items });
});

// GET /api/autopilot/status -> estado del motor + resumen del pipeline
autopilotRouter.get('/autopilot/status', async (_req, res) => {
  const [products, generating, ready, target] = await Promise.all([
    Product.countDocuments({ image: { $ne: null } }),
    Creative.countDocuments({ genStatus: 'generating' }),
    Creative.countDocuments({ genStatus: 'ready' }),
    Promise.resolve(config.autopilotTarget),
  ]);
  const pendientes = await Product.countDocuments({ image: { $ne: null }, generatedCount: { $lt: target } });
  res.json({
    enabled: config.autopilotEnabled,
    intervalMin: config.autopilotIntervalMin,
    target,
    products,
    pendientes,
    generating,
    ready,
  });
});

// POST /api/autopilot/run -> dispara un tick manual
autopilotRouter.post('/autopilot/run', async (_req, res) => {
  const r = await runAutopilot({ manual: true });
  res.json({ ran: Boolean(r), result: r });
});
