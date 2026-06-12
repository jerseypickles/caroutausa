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

// Hook PNG (Anton condensed, blanco con sombra) — UN solo hook para todo el edit.
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

// Beat ELECTRÓNICO sintetizado (kick con pitch-drop + sub + hats offbeat + stab), soft-clip con
// tanh para drive. Placeholder para ver el sync — la música real va en TikTok (su librería).
function beatExpr(beat, total) {
  const B = beat.toFixed(3), H2 = (beat / 2).toFixed(3), B2 = (beat * 2).toFixed(3);
  const kick = `0.9*sin(2*PI*(45+55*exp(-26*mod(t\\,${B})))*t)*exp(-7*mod(t\\,${B}))`;
  const sub = `0.30*sin(2*PI*55*t)*exp(-3.2*mod(t\\,${B}))`;
  const hat = `0.16*sin(2*PI*9000*t)*exp(-95*mod(t+${H2}\\,${B}))`;
  const stab = `0.16*(sin(2*PI*220*t)+sin(2*PI*329*t))*exp(-6*mod(t\\,${B2}))`;
  return `aevalsrc=tanh(${kick}+${sub}+${hat}+${stab}):d=${total}:s=44100`;
}

// EDIT de cortes rápidos cambiando jeans. UN SOLO ffmpeg (sin pérdida generacional): trim+scale de
// cada segmento, concat, overlay del hook, mux del beat -> encode único a CRF alto. clips = buffers
// CRUDOS (sin hook bakeado) para no duplicar el caption.
export async function buildJeansEdit({ clips, hookLine = 'WHICH WASH?', callout = '', bpm = 100, targetSec = 11 }) {
  if (!clips || clips.length < 2) throw new Error('necesito al menos 2 clips');
  const N = clips.length;
  const beat = +(60 / bpm).toFixed(3);
  const nSeg = Math.max(N, Math.round(targetSec / beat));
  const total = +(nSeg * beat).toFixed(3);
  const offsets = [0.6, 2.4, 3.6, 1.5];

  const dir = await mkdtemp(join(tmpdir(), 'vedit-'));
  try {
    const srcPaths = [];
    for (let i = 0; i < N; i++) { const p = join(dir, `src${i}.mp4`); await writeFile(p, clips[i].buffer); srcPaths.push(p); }
    const pngPath = join(dir, 'hook.png');
    await writeFile(pngPath, hookPng(hookLine, callout));

    // plan de segmentos
    const segs = [];
    const counts = new Array(N).fill(0);
    for (let s = 0; s < nSeg; s++) {
      const srcIdx = s % N;
      const off = offsets[Math.floor(s / N) % offsets.length];
      const Z = (s % 2 === 0) ? 1.0 : 1.08;
      segs.push({ srcIdx, off, Z });
      counts[srcIdx]++;
    }
    // filtergraph: split de cada fuente segun cuantas veces se usa (no se puede consumir 2 veces)
    const fc = [];
    const splitPtr = new Array(N).fill(0);
    const splitNames = srcPaths.map((_, i) => Array.from({ length: counts[i] }, (__, k) => `s${i}_${k}`));
    for (let i = 0; i < N; i++) fc.push(`[${i}:v]split=${counts[i]}${splitNames[i].map((n) => `[${n}]`).join('')}`);
    // cada segmento: trim -> normaliza 1080x1920 -> zoom-punch -> fps
    segs.forEach((sg, s) => {
      const label = splitNames[sg.srcIdx][splitPtr[sg.srcIdx]++];
      const zoom = sg.Z > 1.0 ? `crop=iw/${sg.Z}:ih/${sg.Z},scale=${W}:${H},` : '';
      fc.push(`[${label}]trim=start=${sg.off}:end=${(sg.off + beat).toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${zoom}setsar=1,fps=${FPS}[v${s}]`);
    });
    fc.push(`${segs.map((_, s) => `[v${s}]`).join('')}concat=n=${nSeg}:v=1:a=0[vc]`);
    fc.push(`[vc][${N}:v]overlay=0:0[vout]`); // input N = hook.png

    const args = ['-y'];
    for (const p of srcPaths) args.push('-i', p);
    args.push('-i', pngPath);                                   // input N
    args.push('-f', 'lavfi', '-i', beatExpr(beat, total));      // input N+1 (audio)
    args.push('-filter_complex', fc.join(';'),
      '-map', '[vout]', '-map', `${N + 1}:a`,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart',
      join(dir, 'out.mp4'));
    await exec(ffmpegPath, args, { timeout: 240000 });
    return { buffer: await readFile(join(dir, 'out.mp4')), duration: total, segments: nSeg, bpm };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
