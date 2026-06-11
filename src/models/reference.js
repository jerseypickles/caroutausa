import mongoose from 'mongoose';

// Pin de estilo (Pinterest). Las "activas" se usan en la receta de generacion.
const referenceSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    // MULTI-TAG: qué dimensiones aprovecha esta ref (una foto puede dar outfit Y pose, etc.).
    types: { type: [String], default: ['outfit'], index: true }, // ['outfit','pose',...]
    type: { type: String, default: 'outfit' }, // legacy = types[0] (compat)
    favorite: { type: Boolean, default: false }, // se usa mas seguido
    avoid: { type: Boolean, default: false },     // nunca usar (vibe a evitar)
    imageData: { type: String, required: true, select: false }, // base64
    // ADN + brief POR TIPO: { outfit: {struct}, pose: {struct}, scene: {struct} }
    dna: { type: mongoose.Schema.Types.Mixed, default: null },    // struct por tipo (para mostrar)
    briefs: { type: mongoose.Schema.Types.Mixed, default: null },  // brief (string) por tipo (para el director)
    styleDna: { type: String, default: '' }, // legacy = briefs.outfit (compat)
  },
  { timestamps: true }
);

export const Reference = mongoose.model('Reference', referenceSchema);
