import mongoose from 'mongoose';

// Producto de Shopify, sincronizado por el cron. generatedCount=0 => "nuevo"
// (aun no se generaron variantes para el).
const productSchema = new mongoose.Schema(
  {
    shopifyId: { type: Number, required: true, unique: true, index: true },
    title: { type: String, required: true },
    handle: { type: String },
    wash: { type: String },
    description: { type: String, default: '' },
    image: { type: String },
    images: { type: [String], default: [] },
    // Fit/silueta real, derivado del Size Finder de la pagina (medidas exactas).
    // Ancla "que tan ancho vs apretado" en el prompt, sin adjetivos inventados.
    fitSpec: { type: String, default: '' },     // frase precisa para el generador
    fitCut: { type: String, default: '' },      // ej. "relaxed wide straight"
    fitLength: { type: String, default: '' },   // ej. "knee-length"
    fitMeasures: { type: mongoose.Schema.Types.Mixed, default: {} }, // {waistCm,hipCm,thighCm,...}
    sizeText: { type: String, default: '' },    // texto crudo del size finder (para detectar cambios)
    firstSeenAt: { type: Date, default: Date.now },
    generatedCount: { type: Number, default: 0 },
    lastGeneratedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Product = mongoose.model('Product', productSchema);
