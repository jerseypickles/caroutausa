import { config } from './config.js';

// Cliente PiAPI -> Seedance 2.0 (image-to-video). Crea task async + pollea hasta el mp4.
// Docs: POST https://api.piapi.ai/api/v1/task (header X-API-Key). output.video = URL del mp4.
const BASE = 'https://api.piapi.ai/api/v1';

export function piapiConfigured() {
  return Boolean(config.piapiKey);
}

async function piapi(path, { method = 'GET', body = null } = {}) {
  if (!config.piapiKey) throw new Error('PIAPI_KEY no configurada');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'X-API-Key': config.piapiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new Error(`PiAPI ${path}: ${json.message || json.msg || res.status}`);
  }
  return json.data || json;
}

// Crea una task de video Seedance. imageUrls: [start] o [start, last] (URLs PÚBLICAS).
// Devuelve el task_id. fast=true usa seedance-2-fast (más barato/rápido).
export async function createVideoTask({ imageUrls, prompt, duration = 5, aspectRatio = '9:16', resolution = '720p', fast = true }) {
  if (!imageUrls?.length) throw new Error('createVideoTask: falta imageUrls');
  const data = await piapi('/task', {
    method: 'POST',
    body: {
      model: 'seedance',
      // seedance-2-fast = max 720p (rápido/barato); seedance-2 = soporta 1080p (calidad).
      task_type: fast ? 'seedance-2-fast' : 'seedance-2',
      input: {
        prompt,
        mode: 'first_last_frames', // i2v (1 imagen = start; 2 = start+last)
        image_urls: imageUrls,
        duration,
        aspect_ratio: aspectRatio,
        resolution,
      },
    },
  });
  return data.task_id;
}

// Estado de una task. Devuelve { status, videoUrl, raw }.
// status PiAPI: Pending | Processing | Completed | Failed (normalizamos a lower).
export async function getVideoTask(taskId) {
  const data = await piapi(`/task/${taskId}`);
  const status = String(data.status || '').toLowerCase();
  const out = data.output || {};
  const videoUrl = out.video || out.video_url || out.url || null;
  return { status, videoUrl, error: data.error || null, raw: data };
}
