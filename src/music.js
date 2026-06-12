import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import MusicTempo from 'music-tempo';

const exec = promisify(execFile);

// Analiza un track (mp3/wav/m4a) -> BPM + posiciones de los beats (segundos) + duración.
// Decodifica con ffmpeg a PCM mono f32 y se lo pasa a music-tempo (onset + DP). Analizamos los
// primeros ~45s (alcanza para tempo + beats, y el edit dura ~11s) -> rápido y liviano.
export async function analyzeTrack(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'music-'));
  try {
    const inPath = join(dir, 'in');
    const pcmPath = join(dir, 'out.f32');
    await writeFile(inPath, buffer);
    const SR = 22050;
    await exec(ffmpegPath, ['-y', '-i', inPath, '-t', '45', '-ac', '1', '-ar', String(SR), '-f', 'f32le', pcmPath],
      { timeout: 60000, maxBuffer: 1 << 28 });
    const raw = await readFile(pcmPath);
    const float = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
    const audioData = Array.from(float);
    const mt = new MusicTempo(audioData);
    const bpm = Math.round(Number(mt.tempo)) || null;
    const beats = (mt.beats || []).map((b) => +Number(b).toFixed(3)).filter((b) => b >= 0);
    return { bpm, beats, duration: +(float.length / SR).toFixed(2) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
