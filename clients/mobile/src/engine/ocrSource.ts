/**
 * OCR embarqué : modèle Texo (20 M de paramètres, encodeur + décodeur ONNX)
 * exécuté par transformers.js / onnxruntime-web dans la WebView moteur.
 *
 * Modèle provisoire en attendant l'OCR pix2tex distillé du projet : il suffit
 * de changer OCR_MODEL (même format VisionEncoderDecoder ONNX).
 * Texo : https://github.com/alephpi/Texo (AGPL-3.0). Le prétraitement reprend
 * celui de Texo-web (gris, inversion, rognage des marges, 384x384, normalisation UniMERNet).
 */

export interface OcrModelConfig {
  /** identifiant du modèle (dépôt Hugging Face) */
  model: string;
  remoteHost: string;
  remotePathTemplate: string;
  /** fichiers embarqués dans l'APK */
  local?: boolean;
}

export const OCR_MODEL: OcrModelConfig = {
  model: 'alephpi/FormulaNet',
  remoteHost: 'https://huggingface.co/',
  remotePathTemplate: '{model}/resolve/{revision}/',
};

/** Miroir GitHub si Hugging Face est inaccessible */
export const OCR_MODEL_MIRROR: OcrModelConfig = {
  model: 'texo',
  remoteHost: 'https://raw.githubusercontent.com/',
  remotePathTemplate: 'alephpi/Texo-web/refs/heads/master/models/model/',
};

/** Module ES chargé dans la page moteur (configuration dans window.__OCR_CFG) */
export const OCR_MODULE_SOURCE = String.raw`
const CFG = window.__OCR_CFG;
let T = null, libDir = null;
for (const dir of [CFG.local, CFG.cdn]) {
  if (!dir) continue;
  try { T = await import(dir + 'transformers.min.js'); libDir = dir; break; } catch (e) { /* source suivante */ }
}
if (!T) throw new Error('transformers.js introuvable (APK et CDN)');
const { env, VisionEncoderDecoderModel, PreTrainedTokenizer, Tensor, cat } = T;
// moteur WASM d'onnxruntime lu au même endroit que transformers.js (APK si présent)
env.backends.onnx.wasm.wasmPaths = libDir;
env.backends.onnx.wasm.numThreads = 1;      // pas d'isolation cross-origin dans une WebView
env.backends.onnx.wasm.proxy = false;

const SIZE = 384, MEAN = 0.7931, STD = 0.1738;
let model = null, tokenizer = null, loading = null, usedSource = null;

function post(msg) { window.__enginePost(msg); }

async function loadFrom(src) {
  env.allowLocalModels = false;
  env.useBrowserCache = !src.local && typeof caches !== 'undefined';
  env.remoteHost = src.remoteHost;
  env.remotePathTemplate = src.remotePathTemplate;
  const files = {};
  const progress = (p) => {
    if (p.status === 'progress' && p.file) {
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      let l = 0, t = 0;
      for (const k in files) { l += files[k].loaded; t += files[k].total; }
      post({ type: 'status', ocr: 'loading', ocrProgress: t ? Math.round(100 * l / t) : 0 });
    }
  };
  const m = await VisionEncoderDecoderModel.from_pretrained(src.model, { dtype: 'fp32', progress_callback: progress });
  const tk = await PreTrainedTokenizer.from_pretrained(src.model);
  return [m, tk];
}

async function init() {
  if (model) return;
  if (!loading) {
    loading = (async () => {
      const t0 = Date.now();
      post({ type: 'status', ocr: 'loading', ocrProgress: 0 });
      let lastErr = null;
      for (const src of CFG.sources) {
        try {
          [model, tokenizer] = await loadFrom(src);
          usedSource = src.local ? 'apk' : src.remoteHost;
          post({ type: 'status', ocr: 'ready', ocrLoadMs: Date.now() - t0, ocrSource: usedSource });
          return;
        } catch (e) { lastErr = e; }
      }
      loading = null;
      post({ type: 'status', ocr: 'error', error: 'OCR : ' + String(lastErr) });
      throw lastErr;
    })();
  }
  return loading;
}

function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'image/jpeg' });
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/** Image -> tenseur [1,3,384,384] (prétraitement Texo + blanchiment du fond pour les photos) */
async function preprocess(blob, crop) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (crop) {
    sx = Math.max(0, Math.floor(crop.x * bmp.width));
    sy = Math.max(0, Math.floor(crop.y * bmp.height));
    sw = Math.min(bmp.width - sx, Math.ceil(crop.width * bmp.width));
    sh = Math.min(bmp.height - sy, Math.ceil(crop.height * bmp.height));
  }
  // travail à 1024 px max
  const k = Math.min(1, 1024 / Math.max(sw, sh));
  const c1 = canvas(sw * k, sh * k);
  const x1 = c1.getContext('2d', { willReadFrequently: true });
  x1.fillStyle = 'white'; x1.fillRect(0, 0, c1.width, c1.height);
  x1.imageSmoothingQuality = 'high';
  x1.drawImage(bmp, sx, sy, sw, sh, 0, 0, c1.width, c1.height);
  const W = c1.width, H = c1.height;
  const img = x1.getImageData(0, 0, W, H);
  const d = img.data, n = W * H;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];

  // fond sombre / texte clair (tableau noir, écran) : on inverse
  let dark = 0;
  for (let i = 0; i < n; i++) if (g[i] < 200) dark++;
  const sorted = Float32Array.from(g).sort();
  if (dark >= n - dark && sorted[Math.floor(n * 0.5)] < 128) for (let i = 0; i < n; i++) g[i] = 255 - g[i];

  // photo : éclairage inégal. On estime le fond (image très floutée, réduite)
  // et on divise par lui : le papier devient blanc partout, l'encre reste sombre.
  for (let i = 0; i < n; i++) { const v = g[i]; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
  x1.putImageData(img, 0, 0);
  const sw2 = Math.max(4, Math.round(W / 16)), sh2 = Math.max(4, Math.round(H / 16));
  const cs = canvas(sw2, sh2);
  const xs = cs.getContext('2d', { willReadFrequently: true });
  xs.drawImage(c1, 0, 0, sw2, sh2);
  // le fond = maximum local (l'encre est fine) : dilatation 3x3 répétée sur la petite image
  let bgSmall = xs.getImageData(0, 0, sw2, sh2);
  for (let pass = 0; pass < 2; pass++) {
    const src = bgSmall.data, dst = new Uint8ClampedArray(src.length);
    for (let y = 0; y < sh2; y++) for (let x = 0; x < sw2; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(sh2 - 1, Math.max(0, y + dy)), xx = Math.min(sw2 - 1, Math.max(0, x + dx));
        const v = src[4 * (yy * sw2 + xx)]; if (v > m) m = v;
      }
      const o = 4 * (y * sw2 + x); dst[o] = dst[o + 1] = dst[o + 2] = m; dst[o + 3] = 255;
    }
    bgSmall = new ImageData(dst, sw2, sh2);
  }
  xs.putImageData(bgSmall, 0, 0);
  const cb = canvas(W, H);
  const xb = cb.getContext('2d', { willReadFrequently: true });
  xb.filter = 'blur(' + Math.max(2, Math.round(Math.min(W, H) / 40)) + 'px)';
  xb.imageSmoothingQuality = 'high';
  xb.drawImage(cs, 0, 0, W, H);
  const bgd = xb.getImageData(0, 0, W, H).data;
  for (let i = 0; i < n; i++) g[i] = Math.min(255, (g[i] * 255) / Math.max(1, bgd[4 * i]));
  // étirement du contraste : 1 % le plus sombre -> noir
  const s2 = Float32Array.from(g).sort();
  const lo = s2[Math.floor(n * 0.01)];
  if (lo > 0 && lo < 200) for (let i = 0; i < n; i++) g[i] = Math.max(0, (g[i] - lo) * 255 / (255 - lo));

  // rognage des marges (seuil 200 après normalisation min/max)
  let mn = 255, mx = 0;
  for (let i = 0; i < n; i++) { if (g[i] < mn) mn = g[i]; if (g[i] > mx) mx = g[i]; }
  let minX = W, minY = H, maxX = 0, maxY = 0;
  if (mx > mn) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = (g[y * W + x] - mn) / (mx - mn) * 255;
      if (v < 200) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < minX || maxY < minY) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1; }

  for (let i = 0; i < n; i++) { const v = g[i]; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
  x1.putImageData(img, 0, 0);

  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  let scale = SIZE / Math.min(cw, ch);
  let nw = Math.round(cw * scale), nh = Math.round(ch * scale);
  if (nw > SIZE || nh > SIZE) { const r = Math.min(SIZE / nw, SIZE / nh); nw = Math.round(nw * r); nh = Math.round(nh * r); }
  nw = Math.max(1, nw); nh = Math.max(1, nh);
  const c2 = canvas(SIZE, SIZE);
  const x2 = c2.getContext('2d', { willReadFrequently: true });
  x2.fillStyle = 'black'; x2.fillRect(0, 0, SIZE, SIZE);   // même remplissage que Texo
  x2.imageSmoothingQuality = 'high';
  x2.drawImage(c1, minX, minY, cw, ch, Math.floor((SIZE - nw) / 2), Math.floor((SIZE - nh) / 2), nw, nh);
  const out = x2.getImageData(0, 0, SIZE, SIZE).data;
  const arr = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) arr[i] = (out[4 * i] / 255 - MEAN) / STD;
  const t = new Tensor('float32', arr, [1, 1, SIZE, SIZE]);
  return cat([t, t, t], 1);
}

async function recognize(p) {
  const t0 = Date.now();
  await init();
  const t1 = Date.now();
  const pixel_values = await preprocess(b64ToBlob(p.imageBase64, p.mime), p.crop);
  const t2 = Date.now();
  const outputs = await model.generate({ inputs: pixel_values, max_new_tokens: 400 });
  const raw = tokenizer.batch_decode(outputs, { skip_special_tokens: true })[0] || '';
  return { raw: raw, waitMs: t1 - t0, preprocessMs: t2 - t1, inferenceMs: Date.now() - t2, source: usedSource };
}

window.__resolveOcrModule({ init: init, recognize: recognize });
`;
