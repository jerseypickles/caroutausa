import mongoose from 'mongoose';

const { Schema } = mongoose;

// Un VideoClip = un ad de video corto (Reels/Stories) hecho con Seedance i2v.
// Pipeline por etapas: frames (gpt crea start+last) -> curated (gate humano) ->
// animating (Seedance) -> qc (fidelidad del video) -> ready (hook overlay + export).
const videoClipSchema = new Schema(
  {
    shopifyProductId: { type: Number, index: true },
    product: { type: String },
    wash: { type: String },
    sourceImageUrl: { type: String }, // foto de producto base (para regenerar frames)

    // Referencia de estilo usada (fidelidad ref + producto).
    referenceId: { type: String, default: null },
    referenceDna: { type: String, default: '' },
    referenceImageData: { type: String, default: null, select: false },

    // Los DOS frames (start + last) que interpola Seedance. Ambos pasan fidelidad.
    startImageData: { type: String, default: null, select: false }, // base64 webp 9:16
    lastImageData: { type: String, default: null, select: false },
    startFidelity: { type: Number, default: null },
    lastFidelity: { type: Number, default: null },
    fidelityIssues: { type: [String], default: [] },

    // ADN (para el loop de aprendizaje).
    castTag: { type: String, default: null, index: true },
    sceneTag: { type: String, default: null, index: true },
    fontTag: { type: String, default: null, index: true },
    hookLine: { type: String, default: null },
    callout: { type: String, default: null }, // "{WASH} WASH · {fit}" para el overlay

    // Animación (Seedance via PiAPI).
    motionPreset: { type: String, default: 'mirror-sway' },
    motionPrompt: { type: String, default: '' },
    duration: { type: Number, default: 5 },
    taskId: { type: String, default: null, index: true }, // task de PiAPI
    videoUrl: { type: String, default: null },   // URL del mp4 (Seedance)
    videoData: { type: String, default: null, select: false }, // mp4 base64 (lo bajamos para ser dueños)

    // QC del video (fidelidad del short a lo largo del clip).
    videoQc: {
      status: { type: String, enum: ['pending', 'pass', 'fail'], default: 'pending' },
      fidelity: { type: Number, default: null },
      notes: { type: String, default: '' },
    },

    // Etapa del pipeline (las columnas del tab).
    stage: {
      type: String,
      enum: ['frames', 'curated', 'animating', 'qc', 'ready', 'failed'],
      default: 'frames', index: true,
    },
    genStatus: { type: String, enum: ['generating', 'ready', 'failed'], default: 'generating' }, // de los frames
    error: { type: String, default: null },

    // Métricas reales de Meta (mismo loop que creatives/carruseles).
    metrics: {
      impressions: Number, clicks: Number, ctr: Number, spend: Number,
      addToCart: Number, purchases: Number, cpa: Number, updatedAt: Date,
    },

    copy: { // captions del ad (5 primary texts + 5 headlines que Meta A/B-testea)
      primaryTexts: { type: [String], default: [] },
      headlines: { type: [String], default: [] },
      primaryText: { type: String, default: '' },
      headline: { type: String, default: '' },
      edited: { type: Boolean, default: false },
    },

    qcStatus: { type: String, enum: ['generated', 'approved', 'rejected'], default: 'generated', index: true },
    metaAdId: { type: String, default: null },       // ad de Meta (si se lanzó)
    metaCampaignId: { type: String, default: null }, // campaña de Meta
  },
  { timestamps: true }
);

export const VideoClip = mongoose.model('VideoClip', videoClipSchema);
