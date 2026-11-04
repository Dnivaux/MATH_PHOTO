/**
 * OCR embarqué : pix2tex (LaTeX-OCR, licence MIT) exporté en ONNX INT8, exécuté par onnxruntime-web (WASM)
 * dans la WebView du moteur. Trois graphes : redimensionnement, encodeur, décodeur (sans cache, un pas
 * par jeton). Le prétraitement et le décodage reproduisent ceux de pix2tex, validés contre PyTorch par
 * models/pix2tex/export_onnx.py (même texte en sortie).
 *
 * Le modèle distillé du projet (phase 3A) remplacera ces fichiers sans changer ce code : même format
 * (encoder / decoder / resizer + vocab.json + config.json).
 *
 * Sortie : { raw, confidence (moyenne géométrique des probabilités des jetons), temps }.
 */
export const OCR_SOURCE = String.raw`
var OCR = (function () {
  var cfg = null, vocab = null, sess = null, loading = null, loadMs = 0;

  function base() { return window.__OCR_BASE; }

  function getJson(path) { return fetch(base() + path).then(function (r) { if (!r.ok) throw new Error('absent : ' + path); return r.json(); }); }
  function getBuf(path) { return fetch(base() + path).then(function (r) { if (!r.ok) throw new Error('absent : ' + path); return r.arrayBuffer(); }); }

  function init() {
    if (loading) return loading;
    var t0 = Date.now();
    window.__enginePost({ type: 'status', ocr: 'loading' });
    loading = getJson('config.json').then(function (c) {
      cfg = c;
      ort.env.wasm.numThreads = 1;      // pas de SharedArrayBuffer dans une WebView Android
      ort.env.wasm.simd = true;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = window.__ORT_BASE;
      var opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      return Promise.all([
        getJson('vocab.json'),
        getBuf(c.resizer).then(function (b) { return ort.InferenceSession.create(b, opts); }),
        getBuf(c.encoder).then(function (b) { return ort.InferenceSession.create(b, opts); }),
        getBuf(c.decoder).then(function (b) { return ort.InferenceSession.create(b, opts); }),
      ]);
    }).then(function (r) {
      vocab = r[0];
      sess = { resizer: r[1], encoder: r[2], decoder: r[3] };
      loadMs = Date.now() - t0;
      window.__enginePost({ type: 'status', ocr: 'ready', ocrLoadMs: loadMs, ocrModel: cfg.name + ' ' + cfg.version });
      return true;
    }).catch(function (e) {
      loading = null;
      window.__enginePost({ type: 'status', ocr: 'error', error: 'OCR : ' + String(e && e.message || e) });
      throw e;
    });
    return loading;
  }

  // ------------------------------------------------------------ images en niveaux de gris

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  /** {w, h, d: Float32Array 0..255} -> canvas */
  function toCanvas(g) {
    var c = canvas(g.w, g.h), x = c.getContext('2d');
    var img = x.createImageData(g.w, g.h), d = img.data;
    for (var i = 0; i < g.w * g.h; i++) { var v = g.d[i]; d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c;
  }

  function fromCanvas(c) {
    var x = c.getContext('2d', { willReadFrequently: true });
    var d = x.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = d[4 * i];
    return { w: c.width, h: c.height, d: out };
  }

  function resize(g, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === g.w && h === g.h) return g;
    var c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(toCanvas(g), 0, 0, w, h);
    return fromCanvas(c);
  }

  /**
   * Rééchantillonnage identique à Pillow (Image.resize, filtres BILINEAR et LANCZOS, avec anticrénelage à
   * la réduction) : le modèle de redimensionnement est sensible aux pixels, et le lissage du canvas donne
   * d'autres tailles que pix2tex. Deux passes séparables (horizontale puis verticale), arrondi à l'octet.
   */
  var FILTERS = {
    bilinear: { support: 1, f: function (x) { x = Math.abs(x); return x < 1 ? 1 - x : 0; } },
    lanczos: { support: 3, f: function (x) {
      x = Math.abs(x);
      if (x >= 3) return 0;
      if (x < 1e-8) return 1;
      var px = Math.PI * x;
      return 3 * Math.sin(px) * Math.sin(px / 3) / (px * px);
    } },
  };

  function resamplePass(src, inLen, outLen, lines, stride, step, filter) {
    var scale = inLen / outLen, fs = Math.max(scale, 1), support = filter.support * fs;
    var out = new Float32Array(outLen * lines);
    for (var o = 0; o < outLen; o++) {
      var center = (o + 0.5) * scale;
      var xmin = Math.max(Math.floor(center - support + 0.5), 0);
      var xmax = Math.min(Math.floor(center + support + 0.5), inLen);
      var ws = [], sum = 0;
      for (var x = xmin; x < xmax; x++) { var w = filter.f((x - center + 0.5) / fs); ws.push(w); sum += w; }
      for (var k = 0; k < ws.length; k++) ws[k] /= sum || 1;
      for (var l = 0; l < lines; l++) {
        var acc = 0;
        for (var k2 = 0; k2 < ws.length; k2++) acc += ws[k2] * src[l * stride + (xmin + k2) * step];
        out[l * outLen + o] = Math.min(255, Math.max(0, Math.round(acc)));
      }
    }
    return out;
  }

  function pilResize(g, w, h, name) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w === g.w && h === g.h) return g;
    var filter = FILTERS[name];
    var d = g.d, cw = g.w;
    if (w !== g.w) { d = resamplePass(d, g.w, w, g.h, g.w, 1, filter); cw = w; }
    if (h !== g.h) {
      // passe verticale : on lit colonne par colonne et on réécrit ligne par ligne
      var col = resamplePass(d, g.h, h, cw, 1, cw, filter);
      var t = new Float32Array(w * h);
      for (var x = 0; x < cw; x++) for (var y = 0; y < h; y++) t[y * cw + x] = col[x * h + y];
      d = t;
    }
    return { w: w, h: h, d: d };
  }

  /**
   * Photo -> niveaux de gris, avec correction de l'éclairage (le fond, estimé par un maximum local très
   * flouté, est ramené au blanc) : un papier photographié ressemble alors à une formule rendue.
   */
  function loadGray(blob, crop) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' }).then(function (bmp) {
      var sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
      if (crop) {
        sx = Math.max(0, Math.floor(crop.x * bmp.width));
        sy = Math.max(0, Math.floor(crop.y * bmp.height));
        sw = Math.min(bmp.width - sx, Math.ceil(crop.width * bmp.width));
        sh = Math.min(bmp.height - sy, Math.ceil(crop.height * bmp.height));
      }
      var k = Math.min(1, 1024 / Math.max(sw, sh));
      var c1 = canvas(sw * k, sh * k), x1 = c1.getContext('2d', { willReadFrequently: true });
      x1.fillStyle = 'white'; x1.fillRect(0, 0, c1.width, c1.height);
      x1.imageSmoothingQuality = 'high';
      x1.drawImage(bmp, sx, sy, sw, sh, 0, 0, c1.width, c1.height);
      var W = c1.width, H = c1.height, img = x1.getImageData(0, 0, W, H), d = img.data, n = W * H;
      var g = new Float32Array(n);
      for (var i = 0; i < n; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
      var gray = { w: W, h: H, d: g };
      if (!crop && bmp.width <= 800 && bmp.height <= 400) return gray;   // image déjà propre (capture, rendu)

      // fond estimé : image réduite au 1/16, dilatée (maximum 3x3, deux passes), puis floutée et agrandie
      var sw2 = Math.max(4, Math.round(W / 16)), sh2 = Math.max(4, Math.round(H / 16));
      var small = resize(gray, sw2, sh2);
      for (var pass = 0; pass < 2; pass++) {
        var src = small.d, dst = new Float32Array(src.length);
        for (var y = 0; y < sh2; y++) for (var x = 0; x < sw2; x++) {
          var m = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var yy = Math.min(sh2 - 1, Math.max(0, y + dy)), xx = Math.min(sw2 - 1, Math.max(0, x + dx));
            var v = src[yy * sw2 + xx]; if (v > m) m = v;
          }
          dst[y * sw2 + x] = m;
        }
        small = { w: sw2, h: sh2, d: dst };
      }
      var cb = canvas(W, H), xb = cb.getContext('2d', { willReadFrequently: true });
      xb.filter = 'blur(' + Math.max(2, Math.round(Math.min(W, H) / 40)) + 'px)';
      xb.imageSmoothingQuality = 'high';
      xb.drawImage(toCanvas(small), 0, 0, W, H);
      var bg = fromCanvas(cb).d;
      for (var j = 0; j < n; j++) g[j] = Math.min(255, (g[j] * 255) / Math.max(1, bg[j]));
      return gray;
    });
  }

  /** pix2tex.utils.pad : normalisation min/max, inversion si fond sombre, rognage au texte, pad au multiple de 32 */
  function binarizeCropPad(g) {
    var n = g.w * g.h, mn = 255, mx = 0, i;
    for (i = 0; i < n; i++) { if (g.d[i] < mn) mn = g.d[i]; if (g.d[i] > mx) mx = g.d[i]; }
    var span = Math.max(1e-6, mx - mn), data = new Float32Array(n), sum = 0;
    for (i = 0; i < n; i++) { data[i] = (g.d[i] - mn) / span * 255; sum += data[i]; }
    if (sum / n <= 128) for (i = 0; i < n; i++) data[i] = 255 - data[i];
    var minX = g.w, minY = g.h, maxX = -1, maxY = -1;
    for (var y = 0; y < g.h; y++) for (var x = 0; x < g.w; x++) {
      if (data[y * g.w + x] < 128) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = g.w - 1; maxY = g.h - 1; }
    var w = maxX - minX + 1, h = maxY - minY + 1;
    var W = Math.ceil(w / 32) * 32, H = Math.ceil(h / 32) * 32, out = new Float32Array(W * H).fill(255);
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) out[yy * W + xx] = Math.floor(data[(yy + minY) * g.w + xx + minX]);
    return { w: W, h: H, d: out };
  }

  /** pix2tex.cli.minmax_size : réduit sous 672x192, complète au-dessus de 32x32 */
  function minmax(g) {
    var r = Math.max(g.w / cfg.max_width, g.h / cfg.max_height);
    if (r > 1) g = pilResize(g, Math.floor(g.w / r), Math.floor(g.h / r), 'bilinear');
    if (g.w < cfg.min_width || g.h < cfg.min_height) {
      var W = Math.max(g.w, cfg.min_width), H = Math.max(g.h, cfg.min_height), out = new Float32Array(W * H).fill(255);
      for (var y = 0; y < g.h; y++) for (var x = 0; x < g.w; x++) out[y * W + x] = g.d[y * g.w + x];
      g = { w: W, h: H, d: out };
    }
    return g;
  }

  function tensor(g) {
    var a = new Float32Array(g.w * g.h);
    for (var i = 0; i < a.length; i++) a[i] = (g.d[i] / 255 - cfg.mean) / cfg.std;
    return new ort.Tensor('float32', a, [1, 1, g.h, g.w]);
  }

  function argmax(arr) { var b = 0; for (var i = 1; i < arr.length; i++) if (arr[i] > arr[b]) b = i; return b; }

  /** Taille d'entrée conseillée par le modèle de redimensionnement (10 itérations au plus, comme pix2tex) */
  function prepare(gray) {
    var base = minmax(binarizeCropPad(gray));
    var r = 1, w = base.w, h = base.h, img = base;
    function step(i) {
      if (i >= 10) return Promise.resolve(img);
      h = Math.floor(h * r);
      img = binarizeCropPad(minmax(pilResize(base, w, h, r > 1 ? 'bilinear' : 'lanczos')));
      return sess.resizer.run({ image: tensor(img) }).then(function (o) {
        w = (argmax(o.logits.data) + 1) * 32;
        if (w === img.w) return img;
        r = w / img.w;
        return step(i + 1);
      });
    }
    return step(0);
  }

  /** pix2tex.utils.post_process : retire les espaces inutiles du LaTeX */
  function postProcess(s) {
    var textReg = /(\\(operatorname|mathrm|text|mathbf)\s?\*? {.*?})/g;
    var names = (s.match(textReg) || []).map(function (x) { return x.replace(/ /g, ''); });
    s = s.replace(textReg, function () { return names.shift(); });
    var noletter = '[\\W_^\\d]', letter = '[a-zA-Z]';
    var r1 = new RegExp('(?!\\\\ )(' + noletter + ')\\s+?(' + noletter + ')', 'g');
    var r2 = new RegExp('(?!\\\\ )(' + noletter + ')\\s+?(' + letter + ')', 'g');
    var r3 = new RegExp('(' + letter + ')\\s+?(' + noletter + ')', 'g');
    var news = s;
    for (var guard = 0; guard < 100; guard++) {
      s = news;
      news = s.replace(r1, '$1$2').replace(r2, '$1$2').replace(r3, '$1$2');
      if (news === s) break;
    }
    return s;
  }

  function decodeTokens(ids) {
    var s = ids.map(function (i) { return vocab[i] || ''; }).join('').replace(/Ġ/g, ' ');
    s = s.replace(/\[EOS\]|\[BOS\]|\[PAD\]/g, '').trim();
    return postProcess(s);
  }

  function greedy(x) {
    return sess.encoder.run({ image: x }).then(function (enc) {
      var memory = enc.memory, toks = [cfg.bos], logp = 0, count = 0;
      function next() {
        if (toks.length > cfg.max_tokens) return Promise.resolve();
        var t = new ort.Tensor('int64', BigInt64Array.from(toks.map(function (v) { return BigInt(v); })), [1, toks.length]);
        return sess.decoder.run({ tokens: t, memory: memory }).then(function (o) {
          var l = o.logits.data, best = argmax(l), m = l[best], z = 0;
          for (var i = 0; i < l.length; i++) z += Math.exp(l[i] - m);
          logp += -Math.log(z); count++;
          if (best === cfg.eos) return;
          toks.push(best);
          return next();
        });
      }
      return next().then(function () {
        return { ids: toks.slice(1), confidence: count ? Math.exp(logp / count) : 0 };
      });
    });
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/jpeg' });
  }

  function recognize(p) {
    var t0 = Date.now(), t1, t2;
    return init().then(function () {
      t1 = Date.now();
      return loadGray(b64ToBlob(p.imageBase64, p.mime), p.crop);
    }).then(prepare).then(function (img) {
      t2 = Date.now();
      return greedy(tensor(img)).then(function (r) {
        return {
          raw: decodeTokens(r.ids),
          confidence: Math.round(r.confidence * 1000) / 1000,
          tokens: r.ids.length,
          input: [img.w, img.h],
          waitMs: t1 - t0, preprocessMs: t2 - t1, inferenceMs: Date.now() - t2,
          model: cfg.name + ' ' + cfg.version,
        };
      });
    });
  }

  return { init: init, recognize: recognize, _decode: decodeTokens, _postProcess: postProcess };
})();
`;
