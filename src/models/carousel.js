import mongoose from 'mongoose';

const { Schema } = mongoose;

// Una card del carrusel (imagen cohesiva del set).
const cardSchema = new Schema({
  role: { type: String, enum: ['hero', 'pose', 'detail', 'packshot'], default: 'pose' },
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
    referenceId: { type: String, default: null },
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

    analysis: {
      status: { type: String, enum: ['none', 'done'], default: 'none' },
      hook: Number, scrollStop: Number, productFocus: Number,
      ugcFeel: Number, fatigueRisk: Number, overall: Number,
      confidence: String,
      summary: String,
      feedback: { type: [{ label: String, level: String, note: String }], default: [] },
      attention: {
        heat: String,
        zones: { type: [{ label: String, percent: Number, x: Number, y: Number }], default: [] },
      },
      analyzedAt: Date,
    },
  },
  { timestamps: true }
);

export const Carousel = mongoose.model('Carousel', carouselSchema);
