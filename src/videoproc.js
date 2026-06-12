import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { judgeFidelity } from './judge.js';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT = join(__dirname, '../assets/Anton-Regular.ttf'); // condensed-bold "LIGHT.LOOSE." style
GlobalFonts.registerFromPath(FONT, 'Anton');

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

// Dibuja el hook + callout en un PNG transparente (fuente Anton, condensed-bold). El binario
// ffmpeg-static de Render NO trae drawtext, así que el texto lo hacemos con canvas y lo
// superponemos con el filtro `overlay` (que sí está). Determinístico, nítido, no toca el short.
function fitFont(ctx, text, maxW, baseSize) {
  let size = baseSize; ctx.font = `${size}px Anton`;
  while (ctx.measureText(text).width > maxW && size > 12) { size -= 2; ctx.font = `${size}px Anton`; }
  return size;
}
function hookPng(W, H, hookLine, callout) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const maxW = Math.round(W * 0.9);
  const hookY = Math.round(H * 0.095);
  // HOOK (grande, blanco, sombra)
  fitFont(ctx, hookLine.toUpperCase(), maxW, Math.round(H / 15));
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = Math.round(H / 200); ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#fff';
  ctx.fillText(hookLine.toUpperCase(), W / 2, hookY);
  // CALLOUT (chico, muted)
  if (callout) {
    fitFont(ctx, callout.toUpperCase(), maxW, Math.round(H / 46));
    ctx.shadowBlur = Math.round(H / 350); ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(callout.toUpperCase(), W / 2, hookY + Math.round(H / 13));
  }
  return canvas.toBuffer('image/png');
}

// HOOK overlay DETERMINÍSTICO sobre el video (post). Devuelve el nuevo mp4 buffer.
export async function overlayHookVideo(mp4Buffer, { hookLine, callout = '', width = 1080, height = 1920 }) {
  if (!hookLine) return mp4Buffer;
  const dir = await mkdtemp(join(tmpdir(), 'vhook-'));
  const inPath = join(dir, 'in.mp4');
  const pngPath = join(dir, 'hook.png');
  const outPath = join(dir, 'out.mp4');
  await writeFile(inPath, mp4Buffer);
  await writeFile(pngPath, hookPng(width, height, hookLine, callout));
  try {
    await exec(ffmpegPath, ['-y', '-i', inPath, '-i', pngPath, '-filter_complex', '[0][1]overlay=0:0', '-c:a', 'copy', '-movflags', '+faststart', outPath], { timeout: 180000 });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
