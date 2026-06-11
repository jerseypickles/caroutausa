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
    fitSpec: { type: String, default: '' }, // silueta objetivo (del size finder) para mostrar en QC
    angle: { type: String, required: true }, // realista | realismo_completo | gancho_click | llamada_atencion | flatlay
    format: { type: String, enum: ['model', 'flatlay'], default: 'model' }, // foto con modelo vs packshot del producto
    styleMode: { type: String, enum: ['organic', 'campaign'], default: 'organic' }, // look organico vs campaña
    // --- ADN del creativo (para aprender qué rinde) ---
    sceneTag: { type: String, default: null, index: true }, // coast | mirror-apt | rooftop | street | interior | pooldeck
    castTag: { type: String, default: null, index: true },  // fair | olive | moreno | moreno-ink | black | black-ink | latino | mixed | dark-athletic
    hook: { type: String },          // descripcion del primer frame

    // --- imagenes ---
    sourceImageUrl: { type: String, required: true },
    sourceBackUrl: { type: String, default: '' }, // 2da foto del producto (espalda) para tomas de movimiento
    referenceImageRef: { type: String, default: null }, // Fase 2: cara/modelo de referencia
    hasReference: { type: Boolean, default: false },     // se genero con referencia de estilo
    referenceId: { type: String, default: null },        // que referencia se uso (para variedad)
    referenceDna: { type: String, default: '' },         // ADN de estilo de la ref (inspiracion, no clon)
    referenceImageData: { type: String, default: null, select: false }, // pin base64 (preview)
    outputImageRef: { type: String, default: null },    // path/URL en object storage (Fase: R2)
    // Preview base64 hasta la decision de QC. select:false para no arrastrarlo en
    // los listados. imageData = placement story (9:16); feedImageData = feed (4:5).
    imageData: { type: String, default: null, select: false },
    feedImageData: { type: String, default: null, select: false },
    squareImageData: { type: String, default: null, select: false }, // 1:1 cuadrado
    // Variante con HOOK de texto (overlay) por resolucion. Si existen, el launch las usa
    // en vez de las limpias. La limpia queda guardada para A/B.
    hookImageData: { type: String, default: null, select: false },       // 9:16 con hook
    hookSquareImageData: { type: String, default: null, select: false }, // 1:1 con hook
    hookLine: { type: String, default: null },                            // el texto del hook

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
    fidelityScore: { type: Number, default: null },   // 0-100 diseño (wash/rips/hardware)
    fidelityVerdict: { type: String, default: null }, // 'pass' | 'fail' (diseño Y fit)
    fidelityIssues: { type: [String], default: [] },  // que detalles de diseño se perdieron
    fitScore: { type: Number, default: null },        // 0-100 silueta/fit (ancho/largo/cut)
    fitIssues: { type: [String], default: [] },       // diferencias de silueta detectadas
    fidelitySummary: { type: String, default: null }, // una frase
    fidelityError: { type: String, default: null },
    retries: { type: Number, default: 0 }, // reintentos automaticos por fidelidad baja

    // --- Creative Analyzer (estimacion IA de performance, on-demand) ---
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

    // --- copy del ad (generado, editable en QC) ---
    copy: {
      primaryTexts: { type: [String], default: [] }, // hasta 5 (Meta los testea)
      headlines: { type: [String], default: [] },    // hasta 5
      primaryText: { type: String, default: '' },     // compat: = primaryTexts[0]
      headline: { type: String, default: '' },        // compat: = headlines[0]
      edited: { type: Boolean, default: false }, // el humano lo edito
    },

    // --- QC humano ---
    qcStatus: {
      type: String,
      enum: ['generated', 'approved', 'rejected'],
      default: 'generated',
      index: true,
    },
    qcNotes: { type: String }, // por que se rechazo (tell detectado)

    // --- metricas REALES de Meta por creativo (loop de aprendizaje) ---
    metrics: {
      impressions: Number, clicks: Number, ctr: Number, spend: Number,
      addToCart: Number, purchases: Number, cpa: Number,
      updatedAt: Date,
    },

    // --- metricas Meta (legacy) ---
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
