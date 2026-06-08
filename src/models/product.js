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
    firstSeenAt: { type: Date, default: Date.now },
    generatedCount: { type: Number, default: 0 },
    lastGeneratedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Product = mongoose.model('Product', productSchema);
