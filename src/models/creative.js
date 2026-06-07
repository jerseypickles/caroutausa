import mongoose from 'mongoose';

const { Schema } = mongoose;

// Un Creative = una variante generada. El historico es el activo a largo plazo:
// tras 4-5 drops se ven patrones (angulo x wash) y se deja de testear a ciegas.
const creativeSchema = new Schema(
  {
    // --- identidad del drop ---
    drop: { type: String },          // ej. "SS26"
    product: { type: String },       // ej. "Onyx Wash Denim Short"
    wash: { type: String },          // ej. "onyx" | "ice" | "fog"
    angle: { type: String, required: true }, // realista | realismo_completo | gancho_click | llamada_atencion
    hook: { type: String },          // descripcion del primer frame

    // --- imagenes ---
    sourceImageUrl: { type: String, required: true },
    referenceImageRef: { type: String, default: null }, // Fase 2: cara/modelo de referencia
    outputImageRef: { type: String, default: null },    // path/URL en object storage (Fase: R2)
    // Preview base64 hasta la decision de QC. select:false para no arrastrarlo en
    // los listados. Migrar a R2 (outputImageRef) cuando se apruebe. Se limpia al rechazar.
    imageData: { type: String, default: null, select: false },

    // --- QC humano ---
    qcStatus: {
      type: String,
      enum: ['generated', 'approved', 'rejected'],
      default: 'generated',
      index: true,
    },
    qcNotes: { type: String }, // por que se rechazo (tell detectado)

    // --- metricas Meta (se llenan en Fase 3) ---
    spend: { type: Number },
    impressions: { type: Number },
    hookRate3s: { type: Number },
    holdRate: { type: Number },
    ctr: { type: Number },
    cpc: { type: Number },
    addToCart: { type: Number },
    initiateCheckout: { type: Number },
    cpa: { type: Number },
    roas: { type: Number },

    phase: {
      type: String,
      enum: ['testing', 'scaling', 'killed'],
      default: 'testing',
    },
  },
  { timestamps: true } // createdAt / updatedAt
);

export const Creative = mongoose.model('Creative', creativeSchema);
