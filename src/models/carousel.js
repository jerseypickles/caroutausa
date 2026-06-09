import mongoose from 'mongoose';

const { Schema } = mongoose;

// Una card del carrusel (imagen cohesiva del set).
const cardSchema = new Schema({
  role: { type: String, enum: ['hero', 'pose', 'detail'], default: 'pose' },
  order: { type: Number, default: 0 },
  imageData: { type: String, select: false }, // base64 webp
  fidelityScore: { type: Number, default: null },
  fidelityVerdict: { type: String, default: null },
  fidelityIssues: { type: [String], default: [] },
}, { _id: false });

// Un carrusel = set cohesivo de cards de un mismo producto (mismo fondo/colores).
const carouselSchema = new Schema(
  {
    shopifyProductId: { type: Number, index: true },
    product: { type: String },
    wash: { type: String },
    drop: { type: String },
    sourceImageUrl: { type: String, required: true },

    hasReference: { type: Boolean, default: false },
    referenceImageData: { type: String, default: null, select: false },

    genStatus: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating', index: true },
    genError: { type: String, default: null },

    cards: { type: [cardSchema], default: [] },

    // fidelidad global (el peor card manda)
    fidelityStatus: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
    fidelityScore: { type: Number, default: null },
    fidelityVerdict: { type: String, default: null },

    copy: {
      primaryText: { type: String, default: '' },
      headline: { type: String, default: '' },
      edited: { type: Boolean, default: false },
    },

    qcStatus: { type: String, enum: ['generated', 'approved', 'rejected'], default: 'generated', index: true },
    qcNotes: { type: String },
  },
  { timestamps: true }
);

export const Carousel = mongoose.model('Carousel', carouselSchema);
