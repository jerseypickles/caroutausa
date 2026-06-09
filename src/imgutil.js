// Detecta el MIME real de un base64 (png/jpeg/webp) por magic bytes y arma el data URL.
export function mimeFromB64(b64) {
  const buf = Buffer.from(b64.slice(0, 32), 'base64');
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

export function dataUrl(b64) {
  return `data:${mimeFromB64(b64)};base64,${b64}`;
}
