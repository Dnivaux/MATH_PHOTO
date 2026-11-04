/**
 * OCR embarqué : deux lecteurs pix2text-mfr (v1 et 1.5, licence MIT, encodeur DeiT + décodeur TrOCR) en ONNX
 * INT8, exécutés par onnxruntime-web (WASM) dans la WebView du moteur. Chaque lecteur : encodeur, puis décodeur
 * sans cache, un pas par jeton, décodage glouton. Les deux lisent la même image ; l'app compare leurs lectures
 * (vote) : quand elles concordent, la formule est juste dans 99,6 % des cas du banc OCR.
 *
 * Le prétraitement et le décodage reproduisent serving/ocr/trocr_onnx.py (référence Python, validée contre
 * transformers par scripts/p2t_mfr/export.py) : niveaux de gris recopiés sur 3 canaux, redimensionnement
 * bicubique type Pillow en 384 x 384, normalisation (x - 0,5) / 0,5, détokenisation ByteLevel.
 *
 * Sortie : { raw, confidence (moyenne géométrique des probabilités des jetons), readings (une par lecteur), temps }.
 */
export const OCR_SOURCE = String.raw`
var OCR = (function () {
  var readers = null, loading = null, loadMs = 0;

  function base() { return window.__OCR_BASE; }

  function getJson(path) { return fetch(base() + path).then(function (r) { if (!r.ok) throw new Error('absent : ' + path); return r.json(); }); }
  function getBuf(path) { return fetch(base() + path).then(function (r) { if (!r.ok) throw new Error('absent : ' + path); return r.arrayBuffer(); }); }

  function loadReader(name, opts) {
    var dir = name + '/', cfg;
    return getJson(dir + 'config.json').then(function (c) {
      cfg = c;
      // l'un après l'autre : deux graphes de ~30 Mo décompressés en même temps saturent la mémoire de la WebView
      return getJson(dir + 'vocab.json');
    }).then(function (vocab) {
      cfg.vocab = vocab;
      return getBuf(dir + cfg.encoder).then(function (b) { return ort.InferenceSession.create(b, opts); });
    }).then(function (enc) {
      cfg.enc = enc;
      return getBuf(dir + cfg.decoder).then(function (b) { return ort.InferenceSession.create(b, opts); });
    }).then(function (dec) {
      cfg.dec = dec;
      return cfg;
    });
  }

  function init() {
    if (loading) return loading;
    var t0 = Date.now();
    window.__enginePost({ type: 'status', ocr: 'loading' });
    ort.env.wasm.numThreads = 1;      // pas de SharedArrayBuffer dans une WebView Android
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = window.__ORT_BASE;
    var opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    loading = getJson('readers.json').then(function (list) {
      var out = [];
      return list.readers.reduce(function (p, name) {
        return p.then(function () { return loadReader(name, opts); }).then(function (r) { out.push(r); });
      }, Promise.resolve()).then(function () { return out; });
    }).then(function (r) {
      readers = r;
      loadMs = Date.now() - t0;
      window.__enginePost({ type: 'status', ocr: 'ready', ocrLoadMs: loadMs, ocrModel: modelName() });
      return true;
    }).catch(function (e) {
      loading = null;
      window.__enginePost({ type: 'status', ocr: 'error', error: 'OCR : ' + String(e && e.message || e) });
      throw e;
    });
    return loading;
  }

  function modelName() { return readers.map(function (r) { return r.name; }).join(' + '); }

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
    bicubic: { support: 2, f: function (x) {   // a = -0,5, comme Pillow
      var a = -0.5;
      x = Math.abs(x);
      if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
      if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
      return 0;
    } },
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
      // zone lue, en couleur : envoyée au serveur si la lecture est incertaine (relecture par TexTeller)
      var jpeg = c1.toDataURL('image/jpeg', 0.9).replace(/^data:[^,]*,/, '');
      var W = c1.width, H = c1.height, img = x1.getImageData(0, 0, W, H), d = img.data, n = W * H;
      var g = new Float32Array(n);
      for (var i = 0; i < n; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
      var gray = { w: W, h: H, d: g, jpeg: jpeg };
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

  /** Image 384 x 384, recopiée sur 3 canaux et normalisée (DeiTImageProcessor : resample = 3, bicubique) */
  function tensor(g, cfg) {
    var img = pilResize(g, cfg.size, cfg.size, 'bicubic'), n = cfg.size * cfg.size, a = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) { var v = (img.d[i] / 255 - cfg.mean) / cfg.std; a[i] = a[n + i] = a[2 * n + i] = v; }
    return new ort.Tensor('float32', a, [1, 3, cfg.size, cfg.size]);
  }

  function argmax(arr, from, to) { var b = from; for (var i = from + 1; i < to; i++) if (arr[i] > arr[b]) b = i; return b - from; }

  /** Table inverse de bytes_to_unicode (GPT-2) : chaque octet est écrit comme un caractère imprimable */
  var BYTES = null;
  function byteDecoder() {
    if (BYTES) return BYTES;
    var bs = [], cs, n = 0, b;
    for (b = 33; b <= 126; b++) bs.push(b);
    for (b = 161; b <= 172; b++) bs.push(b);
    for (b = 174; b <= 255; b++) bs.push(b);
    cs = bs.slice();
    for (b = 0; b < 256; b++) if (bs.indexOf(b) < 0) { bs.push(b); cs.push(256 + n); n++; }
    BYTES = {};
    for (var i = 0; i < bs.length; i++) BYTES[String.fromCharCode(cs[i])] = bs[i];
    return BYTES;
  }

  /** Jetons ByteLevel -> texte (tokenizer.decode(skip_special_tokens=True)) */
  function detokenize(tokens) {
    var table = byteDecoder(), bytes = [];
    tokens.forEach(function (t) {
      if (!t || (t[0] === '<' && t[t.length - 1] === '>')) return;
      for (var i = 0; i < t.length; i++) { var v = table[t[i]]; if (v !== undefined) bytes.push(v); }
    });
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes)).trim();
  }

  function greedy(r, x) {
    var t0 = Date.now();
    return r.enc.run({ pixel_values: x }).then(function (enc) {
      var memory = enc.last_hidden_state, toks = [r.start], logp = 0, steps = 0, V = r.vocab.length;
      function next() {
        if (steps >= r.max_tokens) return Promise.resolve();
        var t = new ort.Tensor('int64', BigInt64Array.from(toks.map(function (v) { return BigInt(v); })), [1, toks.length]);
        return r.dec.run({ input_ids: t, encoder_hidden_states: memory }).then(function (o) {
          var l = o.logits.data, from = (toks.length - 1) * V, to = from + V, best = argmax(l, from, to), m = l[from + best], z = 0;
          for (var i = from; i < to; i++) z += Math.exp(l[i] - m);
          logp += -Math.log(z); steps++;
          if (best === r.eos) return;
          toks.push(best);
          return next();
        });
      }
      return next().then(function () {
        var ids = toks.slice(1);
        return {
          model: r.name,
          raw: detokenize(ids.map(function (i) { return r.vocab[i]; })),
          confidence: Math.round((steps ? Math.exp(logp / steps) : 0) * 1000) / 1000,
          tokens: ids.length,
          ms: Date.now() - t0,
        };
      });
    });
  }

  /** Les lecteurs l'un après l'autre (WASM sur un seul fil) */
  function readAll(g) {
    var out = [];
    return readers.reduce(function (p, r) {
      return p.then(function () { return greedy(r, tensor(g, r)); }).then(function (res) { out.push(res); });
    }, Promise.resolve()).then(function () { return out; });
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/jpeg' });
  }

  function recognize(p) {
    var t0 = Date.now(), t1, t2, jpeg = null, size = null;
    return init().then(function () {
      t1 = Date.now();
      return loadGray(b64ToBlob(p.imageBase64, p.mime), p.crop);
    }).then(function (gray) {
      jpeg = gray.jpeg || null;
      size = [gray.w, gray.h];
      t2 = Date.now();
      return readAll(gray);
    }).then(function (readings) {
      var first = readings[0];
      return {
        raw: first.raw,
        confidence: first.confidence,
        tokens: first.tokens,
        input: size,
        waitMs: t1 - t0, preprocessMs: t2 - t1, inferenceMs: Date.now() - t2,
        model: modelName(),
        image: jpeg,
        readings: readings,
      };
    });
  }

  return { init: init, recognize: recognize, _detokenize: detokenize };
})();
`;
