import mongoose from 'mongoose';

// Movimientos de video INVENTADOS por el director (exploración). Se guardan para reusarlos
// y que acumulen métricas en el loop de aprendizaje (como los presets fijos).
const motionPresetSchema = new mongoose.Schema(
  {
    tag: { type: String, required: true, unique: true }, // ej 'x-fabric-catch'
    prompt: { type: String, required: true },
    invented: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const MotionPreset = mongoose.model('MotionPreset', motionPresetSchema);
