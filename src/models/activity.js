import mongoose from 'mongoose';

// Log de actividad del motor: que va desarrollando (autopilot, generaciones, errores).
// Alimenta el feed de progreso del panel.
const activitySchema = new mongoose.Schema(
  {
    kind: { type: String, default: 'info' },   // autopilot | single | carousel | flatlay | sync | error
    level: { type: String, default: 'info' },  // info | ok | warn | error
    message: { type: String, default: '' },
    product: { type: String, default: '' },
    refId: { type: String, default: '' },       // id del creative/carrusel relacionado
  },
  { timestamps: true }
);

export const Activity = mongoose.model('Activity', activitySchema);

// Helper: registra un evento sin romper el flujo si falla.
export async function logActivity(kind, message, opts = {}) {
  try {
    await Activity.create({ kind, message, level: opts.level || 'info', product: opts.product || '', refId: opts.refId || '' });
  } catch { /* el logging nunca debe tirar el proceso */ }
}
