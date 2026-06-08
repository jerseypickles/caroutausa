import mongoose from 'mongoose';

// Pin de estilo (Pinterest). Las "activas" se usan en la receta de generacion.
const referenceSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    imageData: { type: String, required: true, select: false }, // base64
  },
  { timestamps: true }
);

export const Reference = mongoose.model('Reference', referenceSchema);
