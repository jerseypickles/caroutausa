import mongoose from 'mongoose';

// Pin de estilo (Pinterest). Las "activas" se usan en la receta de generacion.
const referenceSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    // Tipo de referencia: qué dimensión del creativo inspira.
    type: { type: String, enum: ['outfit', 'scene', 'pose'], default: 'outfit', index: true },
    favorite: { type: Boolean, default: false }, // se usa mas seguido
    avoid: { type: Boolean, default: false },     // nunca usar (vibe a evitar)
    imageData: { type: String, required: true, select: false }, // base64
    styleDna: { type: String, default: '' }, // brief para el director
    dna: { type: mongoose.Schema.Types.Mixed, default: null }, // ADN estructurado (lo que captó: zapas/accesorios/pose/vibe/paleta) para mostrar
  },
  { timestamps: true }
);

export const Reference = mongoose.model('Reference', referenceSchema);
