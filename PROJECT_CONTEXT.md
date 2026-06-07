# CAROTA Ad Creative Engine — Contexto del Proyecto

> Documento de handoff para Claude Code. Define qué construimos, por qué, cómo
> funciona el flujo, las reglas innegociables de realismo, el modelo de datos y
> el deploy a Render. Léelo completo antes de escribir código.

---

## 1. Qué es esto

Un motor que toma la **foto real de un producto** (URL de la página o archivo)
y genera **variantes de creative para ads** en distintos ángulos usando la API
de imágenes de **OpenAI (gpt-image-2)**. El output alimenta el testing de
creatives en Meta para CAROTA.

No usamos Seedance ni ningún otro motor de video/imagen. **Todo OpenAI**, con
nuestra propia API key.

## 2. Contexto de negocio

- **Marca:** CAROTA — streetwear, denim (shorts washed/distressed), drops limitados.
- **Sitio:** carotaus.com (Shopify).
- **Ticket promedio:** ~$55 USD.
- **Público:** hombre joven, urbano, estética streetwear. La venta puede tardar;
  el cliente descubre, sigue, y compra después.
- **Implicación clave:** como la venta tarda, **medimos tracción por señales
  adelantadas (CTR / clicks / Add to Cart), no solo por venta.**

## 3. Objetivo del creative

Generar fotos que:

1. **Llamen altísimo la atención** (que detengan el scroll).
2. **Se vean 100% REALES** — colores reales, luz real, todo real.
   **No se debe notar la IA. Nada.**

Insight central que guía todo: **para este público, lo real ES el gancho.**
El fitpic que parece post real de un pana detiene el scroll más que el ad glossy
de estudio, porque el cerebro filtra lo que huele a publicidad. El impacto viene
del primer frame fuerte (cara, movimiento, actitud) con luz real — no de la
producción. Por eso "máxima atención" y "100% real" no pelean: convergen en el
fitpic auténtico.

## 4. Flujo completo (end-to-end)

```
Foto del producto (fetch)
        │
        ▼
Generación de ángulos (gpt-image-2, images.edit)
        │
        ▼
QC HUMANO  ── descarta cualquier imagen con tell de IA
        │
        ▼
Subida a Meta (ABO, 4–6 ángulos por ronda)
        │
        ▼
Lectura de señales:  reloj rápido (CTR/CPC/hook) → matar/mantener
                     reloj lento (ATC → compra)  → escalar
        │
        ▼
El ganador alimenta el próximo drop  (el sistema aprende)
```

### Los dos relojes (importante para no malinterpretar métricas)

- **Reloj del creative (rápido, días, barato):** hook rate de 3s, hold rate,
  CTR al link, CPC. Se lee con ~1,000–2,000 impresiones (~$10–20) por creative.
  Decide **qué creative matas o mantienes.**
- **Reloj de conversión (lento, semanas, caro):** ATC, Initiate Checkout, CPA,
  ROAS. Meta necesita **~50 conversiones por ad set en 7 días** para salir de
  learning phase. A $55 de ticket eso es plata real → **no se optimiza Purchase
  por creative individual**; se optimiza a nivel campaña y se poda con el reloj
  rápido.

**El puente entre "llamó la atención" y "va a vender" es el Add to Cart.** CTR
alto + ATC alto = el creative atrae al público correcto. CTR alto + ATC en cero
= llama la atención pero engaña → se mata aunque tenga buen CTR.

## 5. El motor de imágenes

- **API:** OpenAI Images, endpoint **`images.edit`** (no `generate` — partimos
  de la foto real del producto).
- **Modelo default:** `gpt-image-2` (lanzado abr-2026, mejor realismo y razonamiento).
  Para bajar costo: `gpt-image-1-mini` / `gpt-image-1`.
- **`input_fidelity`:** la familia `gpt-image-1*` lo acepta (`'high'`) para
  preservar detalle; `gpt-image-2` hace alta fidelidad nativamente. **No lo
  hardcodeamos por escrito:** el código lo manda solo para `gpt-image-1*` y, si
  la API lo rechaza, reintenta sin el parámetro (`src/openai.js`). Verificar
  contra la doc vigente antes de asumir el comportamiento.
- **Input:** se hace `fetch` de la imagen del producto una vez, se pasa como
  `Uploadable` vía `toFile`. El endpoint también acepta URL/base64 directo.
- **Output:** `b64_json` (default para modelos GPT image). Tamaño vertical
  **`1024x1536`** (2:3) para Reels/Stories/feed. `quality: 'high'`.
- **SDK:** `openai` Node v6.x (verificar versión exacta en `package.json` al
  actualizar). Firma usada:
  `client.images.edit({ model, image, prompt, size, quality, n })`.

### Estrategia de prompt: "garment lock"

Cada prompt arranca con una instrucción que **bloquea el producto** y deja que
el modelo solo cambie escena/modelo/luz/mood. Esto evita que invente otro short.

```
Keep the exact garment from the source image unchanged:
same denim wash, same distressing and rips, same stitching,
same hardware and any chains, same cut and fit.
Do not redesign the product. Only change the scene, model,
styling, light and mood as described below.
```

### Los ángulos (presets, prompts en inglés)

| id | qué busca |
|----|-----------|
| `realista` | Fitpic natural, parece contenido orgánico, no ad. iPhone look. |
| `realismo_completo` | Máximo realismo foto, anti-AI (poros, grano, luz real). |
| `gancho_click` | Hero shot que detiene el scroll en el primer frame. |
| `llamada_atencion` | Alto impacto, fondo color-block, lee como nuevo drop. |

Los prompts se editan en un solo archivo (`angles.js`). La estructura importa
más que el texto exacto.

## 6. Reglas de realismo (INNEGOCIABLES)

### Tells de IA que hay que EVITAR en el prompt y matar en QC
- Piel cerosa / plástica, over-smoothing.
- Simetría demasiado perfecta, ese "glow" parejo.
- Fondos estériles sin desorden ni textura.
- Texto de fondo garabateado / ilegible.
- Manos y dedos deformes.
- Joyas o cadenas que "se derriten".
- Bokeh uniforme falso, profundidad de campo irreal.
- Colores HDR sobresaturados.

### Palancas que SÍ dan realismo
- Luz disponible real (ventana, día nublado, golden hour) con sombras reales.
  Nunca luz de estudio perfecta para el ángulo orgánico.
- Imperfecciones: poros, pelo suelto, encuadre ligeramente torcido, leve grano
  de cámara de teléfono, micro motion.
- Color con balance de blancos real, un poco apagado — no saturado.
- Entorno real con textura (calle real, cuarto con cosas), no fondo limpio.
- Lenguaje de cámara real en el prompt (iPhone para orgánico; medium-format /
  50mm para editorial).

### Tradeoff de fidelidad (regla de oro)
**Mientras menos le pidas inventar al modelo, más real sale.** Cambiar solo
escena y luz sobre la foto real = creíble. Pedir cuerpo completo + cara nueva +
escena nueva desde cero = ahí se cuela la IA, sobre todo en cara y manos.

- Para shots donde la cara es el foco → fijar el modelo con una **segunda imagen
  de referencia real** (el endpoint acepta múltiples imágenes de input) o usar
  UGC real.
- Usar IA para volumen, escenas y variaciones de wash donde la cara no manda.

## 7. QC humano (paso obligatorio, no opcional)

Antes de que CUALQUIER imagen toque Meta, pasa por revisión humana. Se revisa:
manos, texto de fondo, joyas/cadenas, caras de fondo, piel, simetría. **Si tiene
aunque sea un tell, se descarta.** No subimos nada con olor a IA — este público
lo detecta y quema la credibilidad de la marca.

El sistema debe tener un estado por creative: `generated → approved | rejected`.
Solo los `approved` son elegibles para Meta.

## 8. Modelo de datos (para que el sistema APRENDA)

Lo valioso a largo plazo es el histórico. Por cada creative guardar:

```
Creative {
  id
  drop            // ej. "SS26"
  product         // ej. "Onyx Wash Denim Short"
  wash            // ej. "onyx" | "ice" | "fog" ...
  angle           // realista | realismo_completo | gancho_click | llamada_atencion
  hook            // descripción del primer frame
  sourceImageUrl
  referenceImageRef // Fase 2: cara/modelo de referencia (nullable desde ya)
  outputImageRef  // path/URL de la variante generada (se llena al aprobar)
  qcStatus        // generated | approved | rejected
  qcNotes         // por qué se rechazó (tell detectado)

  // métricas Meta (se llenan después)
  spend
  impressions
  hookRate3s
  holdRate
  ctr
  cpc
  addToCart
  initiateCheckout
  cpa
  roas

  phase           // testing | scaling | killed
  createdAt
}
```

Con un drop esto es ruido. Tras **4–5 drops** empiezan a verse patrones reales
("fitpic en Ice wash pega, studio en Onyx no") y se deja de testear a ciegas.
**~2–3 meses de drops consistentes** para que los patrones sean confiables.

## 9. Reglas de testing en Meta (para la lógica del sistema)

- Testear **4–6 ángulos por ronda**, no 30 (cada creative necesita su mínimo de
  impresiones para leerse).
- Estructura **ABO** en testing (un ad set por ángulo, mismo público, presupuesto
  fijo por celda) para tener control.
- **Matar** un creative si a los 2–3 días / ~$10–20 no pasa umbral de hook rate
  o CTR.
- **Escalar** (pasar a CBO, más presupuesto) el que engancha Y muestra ATC.
- El ángulo ganador alimenta la siguiente ronda de generación.

## 10. Stack y arquitectura

- **Runtime:** Node.js (ESM, `"type": "module"`).
- **Backend:** Express (se integra al backend existente de las marcas).
- **DB:** MongoDB (modelo de datos arriba).
- **IA:** OpenAI `openai` SDK (`images.edit`, gpt-image-2).
- **Deploy:** **Render** (web service).

### Superficie de API (implementada)

gpt-image-2 tarda ~2 min/imagen → la generación es **async**: el POST responde
al instante (202) y genera en background; el panel hace polling de `/creatives`.

```
POST /api/ad-angles
  body: { imageUrl, angles?: string[], drop?, wash?, product?, hook? }
  → crea Creative(s) con genStatus="generating", responde 202 { queued: [{id,angle}] }
    y dispara la generación en background (cada doc pasa a genStatus
    "ready" | "failed" al terminar).

GET  /api/creatives?drop=&wash=&qcStatus=
  → lista creatives para el panel de QC (sin imageData).

GET  /api/creatives/:id/image
  → sirve el PNG del preview (imageData base64) mientras espera QC.

PATCH /api/creatives/:id/qc
  body: { qcStatus: "approved" | "rejected", qcNotes? }
  → marca el resultado del QC humano. Al rechazar limpia imageData.
```

Estados por creative: `genStatus` (generating → ready | failed) para la
generación, y `qcStatus` (generated → approved | rejected) para el QC humano.

(La integración con la Meta Marketing API para jalar métricas es una fase
posterior — ver roadmap.)

## 11. Deploy a Render (EN VIVO)

- **URL:** https://carota-ad-engine.onrender.com (backend + panel de QC en un
  solo Web Service: Express sirve `public/` → sin CORS, un solo deploy).
- **Service:** `srv-d8itaokvikkc73c7lbeg` · plan **starter** · región virginia.
- **Auto-deploy:** cada push a `main` de `github.com/jerseypickles/caroutausa`.
- **Build command:** `npm install`
- **Start command:** `node src/server.js`
- **Env vars (cargadas en Render, NO en el repo):**
  - `OPENAI_API_KEY` — key de OpenAI.
  - `MONGODB_URI` — Mongo Atlas (cluster0, db `metaads`).
  - `IMAGE_MODEL` — `gpt-image-2`.
  - `PORT` — Render lo inyecta; el server lee `process.env.PORT`.
- **Persistencia de imágenes:** hoy el preview vive en Mongo (`imageData`,
  base64) hasta el QC; se limpia al rechazar. Migrar a object storage (R2) al
  aprobar es el siguiente paso para no inflar la DB con volumen.

## 12. Roadmap de construcción

1. **Fase 1 — Motor + QC (arrancar ya):**
   - `images.edit` con garment lock + los 4 ángulos.
   - Endpoint de generación + guardado en Mongo (`qcStatus="generated"`).
   - Panel/endpoint de QC para aprobar/rechazar.
2. **Fase 2 — Referencia de modelo:**
   - Soportar segunda imagen (cara/cuerpo de referencia) para fijar el look y
     subir realismo en shots con cara.
3. **Fase 3 — Loop con Meta:**
   - Integrar Meta Marketing API para jalar métricas por creative y llenar el
     modelo de datos automáticamente.
   - Reglas automáticas de matar/escalar.
4. **Fase 4 — Inteligencia:**
   - Dashboard de patrones por ángulo × wash sobre el histórico de drops.

## 13. Decisiones (defaults tomados, revisables)

- **Persistencia de imágenes → Cloudflare R2** (sin egress fees; vamos a servir
  muchas vistas al panel de QC y a Meta). API compatible con S3, cero lock-in.
- **Cuándo subir a storage → solo al aprobar en QC.** En generación va base64 en
  la respuesta (preview). No pagamos storage de creatives que vamos a rechazar.
- **QC → endpoint en el backend existente + panel mínimo aparte** (no un panel
  pesado en Fase 1; la cola de QC es ver / approve / reject / nota).
- **Modelo de referencia (cara) → diferido a Fase 2.** Fase 1 arranca sin shots
  con cara protagonista (es donde más se cuela la IA, ver sección 6).

### Aún por confirmar
- Presupuesto diario en Meta para CAROTA (define los tiempos del reloj lento).
- Umbrales numéricos concretos de matar/escalar (hook rate, CTR) para Fase 3.

---

### Principios que no se negocian
1. **Nada con olor a IA llega a Meta.** QC humano siempre.
2. **El producto no se rediseña.** Garment lock en todos los prompts.
3. **Medimos tracción por CTR + ATC**, no solo por venta.
4. **Lo real es el gancho** — autenticidad sobre producción.
