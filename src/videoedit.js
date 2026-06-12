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

// Plan de cortes a partir de los BEATS reales de la canción (cortes EXACTOS al ritmo). Elige cortar
// cada 1 o 2 beats según la densidad (beats muy rápidos -> cada 2), y junta hasta llegar a targetSec.
function beatPlan(beats, targetSec, offsets, N) {
  const sorted = beats.filter((b) => b >= 0).sort((a, b) => a - b);
  const avg = sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) : 0.5;
  const step = avg < 0.4 ? 2 : 1;          // beats muy rápidos -> corta cada 2 (no epiléptico)
  const startIdx = 0;
  const start = sorted[startIdx];
  const segs = []; let total = 0; let s = 0;
  for (let i = startIdx; i + step < sorted.length; i += step) {
    const dur = +(sorted[i + step] - sorted[i]).toFixed(3);
    if (dur < 0.18) continue;
    segs.push({ srcIdx: s % N, off: offsets[Math.floor(s / N) % offsets.length], Z: s % 2 ? 1.08 : 1.0, dur });
    total = +(total + dur).toFixed(3); s++;
    if (total >= targetSec) break;
  }
  return { segs, total, musicStart: +start.toFixed(3) };
}

// EDIT de cortes rápidos. UN SOLO ffmpeg (sin pérdida generacional): trim+scale de cada segmento,
// concat, overlay del hook, audio -> encode único a CRF alto. clips = buffers CRUDOS (sin hook).
// music = { buffer, beats } -> corta EXACTO a los beats de esa canción; si no, beat sintetizado.
export async function buildJeansEdit({ clips, hookLine = 'WHICH WASH?', callout = '', bpm = 100, targetSec = 11, music = null }) {
  if (!clips || clips.length < 2) throw new Error('necesito al menos 2 clips');
  const N = clips.length;
  const offsets = [0.6, 2.4, 3.6, 1.5];
  const hasMusic = music && music.buffer && music.beats && music.beats.length > 4;

  // plan de segmentos: por beats reales (música) o grilla fija (beat sintetizado).
  let segs, total, musicStart = 0;
  if (hasMusic) {
    ({ segs, total, musicStart } = beatPlan(music.beats, targetSec, offsets, N));
  }
  if (!hasMusic || segs.length < 2) {
    const beat = +(60 / bpm).toFixed(3);
    const nSeg = Math.max(N, Math.round(targetSec / beat));
    segs = Array.from({ length: nSeg }, (_, s) => ({ srcIdx: s % N, off: offsets[Math.floor(s / N) % offsets.length], Z: s % 2 ? 1.08 : 1.0, dur: beat }));
    total = +(nSeg * beat).toFixed(3);
  }
  const nSeg = segs.length;

  const dir = await mkdtemp(join(tmpdir(), 'vedit-'));
  try {
    const srcPaths = [];
    for (let i = 0; i < N; i++) { const p = join(dir, `src${i}.mp4`); await writeFile(p, clips[i].buffer); srcPaths.push(p); }
    const pngPath = join(dir, 'hook.png');
    await writeFile(pngPath, hookPng(hookLine, callout));
    let musicPath = null;
    if (hasMusic) { musicPath = join(dir, 'music'); await writeFile(musicPath, music.buffer); }

    const counts = new Array(N).fill(0);
    for (const sg of segs) counts[sg.srcIdx]++;
    const fc = [];
    const splitPtr = new Array(N).fill(0);
    const splitNames = srcPaths.map((_, i) => Array.from({ length: counts[i] }, (__, k) => `s${i}_${k}`));
    for (let i = 0; i < N; i++) fc.push(`[${i}:v]split=${counts[i]}${splitNames[i].map((n) => `[${n}]`).join('')}`);
    // cada segmento: trim (su duración) -> normaliza 1080x1920 -> zoom-punch -> fps
    segs.forEach((sg, s) => {
      const label = splitNames[sg.srcIdx][splitPtr[sg.srcIdx]++];
      const zoom = sg.Z > 1.0 ? `crop=iw/${sg.Z}:ih/${sg.Z},scale=${W}:${H},` : '';
      fc.push(`[${label}]trim=start=${sg.off}:end=${(sg.off + sg.dur).toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${zoom}setsar=1,fps=${FPS}[v${s}]`);
    });
    fc.push(`${segs.map((_, s) => `[v${s}]`).join('')}concat=n=${nSeg}:v=1:a=0[vc]`);
    fc.push(`[vc][${N}:v]overlay=0:0[vout]`); // input N = hook.png

    const args = ['-y'];
    for (const p of srcPaths) args.push('-i', p);
    args.push('-i', pngPath);                                   // input N
    let audioMap;
    if (hasMusic) {
      args.push('-ss', String(musicStart), '-i', musicPath);   // input N+1 = la canción (desde el beat 0)
      fc.push(`[${N + 1}:a]afade=t=out:st=${(total - 0.3).toFixed(2)}:d=0.3[aout]`); // fade out suave
      audioMap = '[aout]';
    } else {
      args.push('-f', 'lavfi', '-i', beatExpr(60 / bpm, total)); // input N+1 = beat sintetizado
      audioMap = `${N + 1}:a`;
    }
    args.push('-filter_complex', fc.join(';'),
      '-map', '[vout]', '-map', audioMap,
      // Un solo encode, calidad alta PERO bitrate capado (~5.5Mbps) para que el mp4 quede <8MB y
      // entre en el doc de Mongo (limite 16MB en base64). A esta tasa se ve nitido y las redes
      // recomprimen a 3-4Mbps igual, asi que no se nota.
      '-c:v', 'libx264', '-crf', '21', '-maxrate', '5500k', '-bufsize', '9000k', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-t', String(total), '-movflags', '+faststart',
      join(dir, 'out.mp4'));
    await exec(ffmpegPath, args, { timeout: 240000 });
    return { buffer: await readFile(join(dir, 'out.mp4')), duration: total, segments: nSeg, bpm, music: hasMusic };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
