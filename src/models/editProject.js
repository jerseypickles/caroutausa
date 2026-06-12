import mongoose from 'mongoose';

const { Schema } = mongoose;

// Un EditProject = UN jean con su SET de tomas (shots) editado en un solo reel de retención.
// Flujo: shots (genera N tomas del MISMO jean) -> animan + QC -> editing (arma el edit con
// beat-sync) -> ready. CTA del ad = ESE producto (embudo limpio, no multi-jean).
const editProjectSchema = new Schema(
  {
    shopifyProductId: { type: Number, index: true },
    product: { type: String },
    wash: { type: String },
    sourceImageUrl: { type: String },

    // Ref de estilo (misma para todas las tomas -> coherencia).
    referenceId: { type: String, default: null },
    referenceDna: { type: String, default: '' },

    // Setting + luz FIJOS (todas las tomas comparten -> el edit se ve como UNA pieza, no 4 videos).
    setting: { type: String, default: null },
    lighting: { type: String, default: null },

    shotTypes: { type: [String], default: ['fit-check', 'detalle', 'walk', 'side'] },
    shotIds: { type: [Schema.Types.ObjectId], ref: 'VideoClip', default: [] },

    // Música: referencia a una pista de la librería (el edit corta al beat de ESA canción).
    musicTrackId: { type: Schema.Types.ObjectId, ref: 'MusicTrack', default: null },
    musicName: { type: String, default: null }, // cacheado para mostrar sin populate
    preset: { type: String, default: 'build-to-drop' }, // build-to-drop | which-wash (futuro)

    hookLine: { type: String, default: null },
    callout: { type: String, default: null },

    // El edit final.
    editVideoData: { type: String, default: null, select: false }, // mp4 base64
    editDuration: { type: Number, default: null },

    stage: { type: String, enum: ['shots', 'editing', 'ready', 'failed'], default: 'shots', index: true },
    error: { type: String, default: null },

    qcStatus: { type: String, enum: ['generated', 'approved', 'rejected'], default: 'generated', index: true },
    copy: {
      primaryTexts: { type: [String], default: [] },
      headlines: { type: [String], default: [] },
      primaryText: { type: String, default: '' },
      headline: { type: String, default: '' },
      edited: { type: Boolean, default: false },
    },
    metaAdId: { type: String, default: null },
    metaCampaignId: { type: String, default: null },
    metrics: {
      impressions: Number, clicks: Number, ctr: Number, spend: Number,
      addToCart: Number, purchases: Number, cpa: Number, updatedAt: Date,
    },
  },
  { timestamps: true }
);

export const EditProject = mongoose.model('EditProject', editProjectSchema);
