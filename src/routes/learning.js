import { Router } from 'express';
import { syncCreativeMetrics, learningReport } from '../learning.js';

export const learningRouter = Router();

// POST /api/learning/sync -> trae métricas de Meta y las pega a cada creativo
learningRouter.post('/learning/sync', async (_req, res) => {
  try { res.json(await syncCreativeMetrics()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// GET /api/learning -> leaderboard de qué ADN (escena/casting/ángulo/wash/formato) rinde
learningRouter.get('/learning', async (_req, res) => {
  try { res.json(await learningReport()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
