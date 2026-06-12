import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT = join(__dirname, '../assets/Anton-Regular.ttf');
GlobalFonts.registerFromPath(FONT, 'Anton');

const W = 1080, H = 1920, FPS = 30;

// Hook PNG (mismo estilo que el overlay de un clip: Anton condensed, blanco con sombra).
function fitFont(ctx, text, maxW, baseSize) {
  let size = baseSize; ctx.font = `${size}px Anton`;
  while (ctx.measureText(text).width > maxW && size > 12) { size -= 2; ctx.font = `${size}px Anton`; }
  return size;
}
function hookPng(hookLine, callout) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const maxW = Math.round(W * 0.9);
  const hookY = Math.round(H * 0.095);
  fitFont(ctx, hookLine.toUpperCase(), maxW, Math.round(H / 14));
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = Math.round(H / 200); ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#fff';
  ctx.fillText(hookLine.toUpperCase(), W / 2, hookY);
  if (callout) {
    fitFont(ctx, callout.toUpperCase(), maxW, Math.round(H / 46));
    ctx.shadowBlur = Math.round(H / 350); ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(callout.toUpperCase(), W / 2, hookY + Math.round(H / 13));
  }
  return canvas.toBuffer('image/png');
}

// EDIT de cortes rápidos: cicla por N clips (jeans/washes distintos) cortando ~1 beat cada uno,
// con un zoom-punch alternado en cada corte, beat sintetizado (four-on-floor) para que pegue, y
// el hook arriba todo el clip. PROTOTIPO para ver el formato antes de desarrollarlo grande.
export async function buildJeansEdit({ clips, hookLine = 'WHICH WASH?', callout = '', bpm = 100, targetSec = 11 }) {
  if (!clips || clips.length < 2) throw new Error('necesito al menos 2 clips');
  const beat = +(60 / bpm).toFixed(3);          // largo de cada corte (1 beat)
  const half = +(beat / 2).toFixed(3);
  const nSeg = Math.max(clips.length, Math.round(targetSec / beat));
  const total = +(nSeg * beat).toFixed(3);
  const offsets = [0.6, 2.4, 3.7, 1.5];         // distintos puntos del clip de 5s (varía las repeticiones)

  const dir = await mkdtemp(join(tmpdir(), 'vedit-'));
  try {
    // 1) escribe los clips fuente
    const srcPaths = [];
    for (let i = 0; i < clips.length; i++) {
      const p = join(dir, `src${i}.mp4`);
      await writeFile(p, clips[i].buffer);
      srcPaths.push(p);
    }
    // 2) corta cada segmento normalizado (1080x1920, 30fps) con zoom-punch alternado
    const segPaths = [];
    for (let s = 0; s < nSeg; s++) {
      const srcIdx = s % clips.length;
      const off = offsets[Math.floor(s / clips.length) % offsets.length];
      const Z = (s % 2 === 0) ? 1.0 : 1.12;     // pop de tamaño en cada corte
      const zoomVf = Z > 1.0 ? `,crop=iw/${Z}:ih/${Z},scale=${W}:${H}` : '';
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1${zoomVf},fps=${FPS}`;
      const segPath = join(dir, `seg${String(s).padStart(2, '0')}.mp4`);
      await exec(ffmpegPath, ['-y', '-ss', String(off), '-t', String(beat), '-i', srcPaths[srcIdx],
        '-an', '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', segPath], { timeout: 60000 });
      segPaths.push(segPath);
    }
    // 3) concatena (re-encode para robustez)
    const listPath = join(dir, 'list.txt');
    await writeFile(listPath, segPaths.map((p) => `file '${p}'`).join('\n'));
    const silentPath = join(dir, 'silent.mp4');
    await exec(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), silentPath], { timeout: 120000 });
    // 4) beat four-on-floor sintetizado (kick + hat) — placeholder para ver el sync; la música real
    //    va en TikTok (su librería) o se licencia para Meta.
    const expr = `0.7*sin(2*PI*58*t)*exp(-9*mod(t\\,${beat}))+0.18*sin(2*PI*3800*t)*exp(-70*mod(t+${half}\\,${beat}))`;
    const beatPath = join(dir, 'beat.wav');
    await exec(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `aevalsrc=${expr}:d=${total}:s=44100`, beatPath], { timeout: 60000 });
    // 5) overlay del hook + mux del beat
    const pngPath = join(dir, 'hook.png');
    await writeFile(pngPath, hookPng(hookLine, callout));
    const outPath = join(dir, 'out.mp4');
    await exec(ffmpegPath, ['-y', '-i', silentPath, '-i', beatPath, '-i', pngPath,
      '-filter_complex', '[0:v][2:v]overlay=0:0[v]', '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outPath], { timeout: 180000 });
    return { buffer: await readFile(outPath), duration: total, segments: nSeg, bpm };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
