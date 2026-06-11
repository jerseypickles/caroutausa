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
    sceneTag: { type: String, default: null, index: true }, // ADN: escena del hero
    castTag: { type: String, default: null, index: true },  // ADN: casting del hero
    hookLine: { type: String, default: null },              // texto del hook (en el hero)
    fontTag: { type: String, default: null, index: true },  // ADN: fuente del hook
    metrics: { // métricas reales de Meta (loop de aprendizaje)
      impressions: Number, clicks: Number, ctr: Number, spend: Number,
      addToCart: Number, purchases: Number, cpa: Number, updatedAt: Date,
    },

    hasReference: { type: Boolean, default: false },
    referenceId: { type: String, default: null },
    referenceDna: { type: String, default: '' },
    referenceImageData: { type: String, default: null, select: false },

    genStatus: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating', index: true },
    genError: { type: String, default: null },

    cards: { type: [cardSchema], default: [] },

    // fidelidad global (el peor card manda)
    fidelityStatus: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
    fidelityScore: { type: Number, default: null },
    fidelityVerdict: { type: String, default: null },

    copy: {
      primaryTexts: { type: [String], default: [] },
      headlines: { type: [String], default: [] },
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
