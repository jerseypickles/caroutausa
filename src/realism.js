import sharp from 'sharp';

// Pase de realismo "foto de iPhone real": grano fino + tono natural (un toque menos
// saturado/contrastado) + micro-suavizado de camara + leve compresion. Empuja el look
// de foto organica y disimula el acabado plastico/limpio de IA. Devuelve b64 webp.
// Sutil a proposito: la idea es que se sienta real, no "filtrado".
export async function realismPass(b64) {
  try {
    const input = Buffer.from(b64, 'base64');
    const meta = await sharp(input).metadata();
    const w = meta.width || 1024;
    const h = meta.height || 1024;

    // Capa de ruido gaussiano -> grano de pelicula/sensor.
    const noise = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 0, sigma: 11 } },
    }).png().toBuffer();

    const out = await sharp(input)
      .modulate({ saturation: 0.95 })          // un poco menos saturado (color de telefono)
      .linear(0.97, 4)                         // leve baja de contraste, negros no tan puros
      .composite([{ input: noise, blend: 'soft-light' }]) // grano fino
      .blur(0.3)                               // micro-suavizado de lente
      .sharpen({ sigma: 0.6 })                 // textura sutil de vuelta
      .webp({ quality: 82 })
      .toBuffer();

    return out.toString('base64');
  } catch (e) {
    console.error('[realism] fallo, devuelvo original:', e.message);
    return b64;
  }
}
