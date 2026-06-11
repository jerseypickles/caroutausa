import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';
import { judgeFidelity } from './judge.js';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT = join(__dirname, '../assets/Anton-Regular.ttf'); // condensed-bold "LIGHT.LOOSE." style

// Extrae `count` frames distribuidos del mp4 (buffer) -> array de PNG buffers.
export async function extractFrames(mp4Buffer, duration = 5, count = 3) {
  const dir = await mkdtemp(join(tmpdir(), 'vqc-'));
  const inPath = join(dir, 'in.mp4');
  await writeFile(inPath, mp4Buffer);
  const frames = [];
  try {
    for (let i = 0; i < count; i++) {
      const t = Math.max(0.1, (duration * (i + 0.5)) / count); // distribuidos (ej 0.83, 2.5, 4.16)
      const outPath = join(dir, `f${i}.png`);
      await exec(ffmpegPath, ['-y', '-ss', t.toFixed(2), '-i', inPath, '-frames:v', '1', '-q:v', '2', outPath], { timeout: 30000 });
      frames.push(await readFile(outPath));
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return frames;
}

// QC AUTOMÁTICO del video: muestrea frames y juzga la fidelidad del short en cada uno.
// Devuelve el PEOR score (el frame más deformado manda) + issues.
export async function judgeVideoFidelity({ mp4Buffer, duration = 5, sourceImageUrl, fitSpec = '' }) {
  const frames = await extractFrames(mp4Buffer, duration, 3);
  const scores = [];
  const issues = [];
  for (const f of frames) {
    const v = await judgeFidelity({ sourceImageUrl, b64: f.toString('base64'), fitSpec }).catch(() => null);
    if (v) { scores.push(v.score ?? 0); if (v.issues?.length) issues.push(...v.issues); }
  }
  const worst = scores.length ? Math.min(...scores) : null;
  return { score: worst, frames: scores.length, issues: [...new Set(issues)].slice(0, 5) };
}

// Escapa texto para el filtro drawtext de ffmpeg.
function escTxt(t) { return String(t || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%'); }

// HOOK overlay DETERMINÍSTICO sobre el video (post): hook condensed-bold + callout, arriba,
// blanco con sombra (no toca el short). Devuelve el nuevo mp4 buffer.
export async function overlayHookVideo(mp4Buffer, { hookLine, callout = '' }) {
  if (!hookLine) return mp4Buffer;
  const dir = await mkdtemp(join(tmpdir(), 'vhook-'));
  const inPath = join(dir, 'in.mp4');
  const outPath = join(dir, 'out.mp4');
  await writeFile(inPath, mp4Buffer);
  const F = FONT.replace(/\\/g, '/').replace(/:/g, '\\:');
  const hook = escTxt(hookLine.toUpperCase());
  const call = escTxt(callout.toUpperCase());
  let vf = `drawtext=fontfile='${F}':text='${hook}':fontcolor=white:fontsize=h/15:x=(w-text_w)/2:y=h*0.055:shadowcolor=black@0.6:shadowx=3:shadowy=3`;
  if (call) vf += `,drawtext=fontfile='${F}':text='${call}':fontcolor=white@0.9:fontsize=h/42:x=(w-text_w)/2:y=h*0.055+h/13:shadowcolor=black@0.5:shadowx=2:shadowy=2`;
  try {
    await exec(ffmpegPath, ['-y', '-i', inPath, '-vf', vf, '-c:a', 'copy', '-movflags', '+faststart', outPath], { timeout: 180000 });
    const out = await readFile(outPath);
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
