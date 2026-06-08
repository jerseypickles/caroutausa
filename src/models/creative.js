import mongoose from 'mongoose';

const { Schema } = mongoose;

// Un Creative = una variante generada. El historico es el activo a largo plazo:
// tras 4-5 drops se ven patrones (angulo x wash) y se deja de testear a ciegas.
const creativeSchema = new Schema(
  {
    // --- identidad del drop ---
    drop: { type: String },          // ej. "SS26"
    shopifyProductId: { type: Number, default: null, index: true },
    product: { type: String },       // ej. "Onyx Wash Denim Short"
    wash: { type: String },          // ej. "onyx" | "ice" | "fog"
    angle: { type: String, required: true }, // realista | realismo_completo | gancho_click | llamada_atencion
    hook: { type: String },          // descripcion del primer frame

    // --- imagenes ---
    sourceImageUrl: { type: String, required: true },
    referenceImageRef: { type: String, default: null }, // Fase 2: cara/modelo de referencia
    hasReference: { type: Boolean, default: false },     // se genero con referencia de estilo
    referenceImageData: { type: String, default: null, select: false }, // pin base64 (preview)
    outputImageRef: { type: String, default: null },    // path/URL en object storage (Fase: R2)
    // Preview base64 hasta la decision de QC. select:false para no arrastrarlo en
    // los listados. Migrar a R2 (outputImageRef) cuando se apruebe. Se limpia al rechazar.
    imageData: { type: String, default: null, select: false },

    // --- estado de generacion (async) ---
    genStatus: {
      type: String,
      enum: ['generating', 'ready', 'failed'],
      default: 'ready',
      index: true,
    },
    genError: { type: String, default: null }, // mensaje si la generacion fallo

    // --- juez de fidelidad (vision: compara generada vs jean original) ---
    fidelityStatus: {
      type: String,
      enum: ['pending', 'done', 'failed'],
      default: 'pending',
      index: true,
    },
    fidelityScore: { type: Number, default: null },   // 0-100 (100 = garment identico)
    fidelityVerdict: { type: String, default: null }, // 'pass' | 'fail'
    fidelityIssues: { type: [String], default: [] },  // que detalles se perdieron
    fidelitySummary: { type: String, default: null }, // una frase
    fidelityError: { type: String, default: null },
    retries: { type: Number, default: 0 }, // reintentos automaticos por fidelidad baja

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
