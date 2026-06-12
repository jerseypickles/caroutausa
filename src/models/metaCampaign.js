import mongoose from 'mongoose';

const { Schema } = mongoose;

// Una campaña lanzada a Meta (campaign + adset + ads), con sus IDs para gestionar.
const metaCampaignSchema = new Schema(
  {
    name: { type: String, required: true },
    campaignId: { type: String, required: true },
    adSetId: { type: String, required: true },
    objective: { type: String, default: 'OUTCOME_SALES' },
    optimizationEvent: { type: String, default: 'ADD_TO_CART' },
    dailyBudget: { type: Number },   // dolares
    countries: { type: [String], default: ['US'] },
    status: { type: String, default: 'PAUSED' }, // PAUSED | ACTIVE | DELETED

    ads: [
      {
        adId: String,
        metaCreativeId: String,
        creativeId: { type: Schema.Types.ObjectId, ref: 'Creative' }, // nuestro creative (puede borrarse)
        product: String,
        link: String,
        format: { type: String, default: 'single' }, // single | carousel | video
        // SNAPSHOT del ADN al lanzar (durable -> el aprendizaje sobrevive aunque se borre el creativo).
        adn: {
          castTag: String, sceneTag: String, angle: String, wash: String,
          fontTag: String, motionPreset: String,
        },
        // métricas reales de Meta por ad (la fuente del aprendizaje).
        metrics: {
          impressions: Number, clicks: Number, ctr: Number, spend: Number,
          addToCart: Number, purchases: Number, cpa: Number, updatedAt: Date,
        },
      },
    ],

    // metricas cacheadas (ultimo refresh)
    insights: {
      impressions: Number,
      clicks: Number,
      ctr: Number,
      cpc: Number,
      spend: Number,
      addToCart: Number,
      purchases: Number,
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

export const MetaCampaign = mongoose.model('MetaCampaign', metaCampaignSchema);
