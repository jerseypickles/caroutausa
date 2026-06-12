import mongoose from 'mongoose';

const { Schema } = mongoose;

// Una pista de música subida por el usuario. Se analiza al subir (BPM + posiciones de beats) y el
// edit corta EXACTO a esos beats. Vive en su propia colección (no en EditProject) para no inflar
// el doc del edit (16MB) y para reusar la misma pista en varios edits.
const musicTrackSchema = new Schema(
  {
    name: { type: String, required: true },
    bpm: { type: Number, default: null },
    beats: { type: [Number], default: [] },     // segundos
    duration: { type: Number, default: null },
    data: { type: String, default: null, select: false }, // base64 del audio
    mime: { type: String, default: 'audio/mpeg' },
    uses: { type: Number, default: 0 },          // cuántos edits la usaron
  },
  { timestamps: true }
);

export const MusicTrack = mongoose.model('MusicTrack', musicTrackSchema);
