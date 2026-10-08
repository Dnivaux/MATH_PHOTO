/**
 * Fichiers embarqués dans l'APK (android/app/src/main/assets/engine/), copiés
 * par `npm run engine-assets`. Les WebView sont chargées avec ce dossier comme
 * baseUrl : tout fonctionne hors ligne. Si un fichier manque, chaque page se
 * replie sur le CDN.
 */
export const ASSET_BASE = 'file:///android_asset/engine/';

export const VERSIONS = {
  cortex: '0.30.2',
  pyodide: '0.27.7',
  transformers: '3.7.5',
  katex: '0.16.11',
  mathlive: '0.107.1',
};

export const CDN = {
  cortex: `https://cdn.jsdelivr.net/npm/@cortex-js/compute-engine@${VERSIONS.cortex}/dist/compute-engine.min.umd.js`,
  pyodide: `https://cdn.jsdelivr.net/pyodide/v${VERSIONS.pyodide}/full/`,
  transformers: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSIONS.transformers}/dist/`,
  katex: `https://cdn.jsdelivr.net/npm/katex@${VERSIONS.katex}/dist/`,
  mathlive: `https://cdn.jsdelivr.net/npm/mathlive@${VERSIONS.mathlive}/`,
};

/** Chemins relatifs à ASSET_BASE */
export const LOCAL = {
  cortex: 'cortex/compute-engine.min.umd.js',
  pyodide: 'pyodide/',
  transformers: 'transformers/',
  katex: 'katex/',
  mathlive: 'mathlive/',
  ocrModels: 'models/',
};

/** Props à passer à toute WebView qui lit les fichiers embarqués */
export const FILE_ACCESS_PROPS = {
  allowFileAccess: true,
  allowFileAccessFromFileURLs: true,
  allowUniversalAccessFromFileURLs: true,
  originWhitelist: ['*'] as string[],
};

/**
 * fetch() ne sait pas lire file:// dans une WebView : on le remplace pour ces
 * adresses par un XMLHttpRequest (autorisé par allowFileAccessFromFileURLs).
 * Utilisable dans une page comme dans un Worker.
 */
export const FETCH_SHIM = String.raw`
(function (g) {
  if (g.__fetchShim) return;
  g.__fetchShim = true;
  var nativeFetch = g.fetch ? g.fetch.bind(g) : null;
  var TYPES = { wasm: 'application/wasm', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
    css: 'text/css', zip: 'application/zip', whl: 'application/zip', onnx: 'application/octet-stream',
    woff2: 'font/woff2', txt: 'text/plain' };
  g.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var base = (g.document && g.document.baseURI) || (g.__baseURI || '');
    var abs;
    try { abs = new URL(url, base).href; } catch (e) { abs = url; }
    if (abs.indexOf('file:') !== 0 || !g.XMLHttpRequest) return nativeFetch(input, init);
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', abs);
      x.responseType = 'arraybuffer';
      x.onload = function () {
        if ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength >= 0) {
          var ext = abs.split('?')[0].split('.').pop().toLowerCase();
          resolve(new Response(x.response, { status: 200, headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream',
            'Content-Length': String(x.response.byteLength) } }));
        } else {
          resolve(new Response('', { status: 404 }));
        }
      };
      x.onerror = function () { resolve(new Response('', { status: 404 })); };
      x.send();
    });
  };
  /** true si l'adresse répond (fichier présent) */
  g.__exists = function (url) {
    return g.fetch(url).then(function (r) { return r.ok; }, function () { return false; });
  };
})(typeof self !== 'undefined' ? self : window);
`;

/** Charge un script classique en local, sinon depuis le CDN (à utiliser dans les pages) */
export const LOAD_SCRIPT_HELPER = String.raw`
function __loadScript(src) {
  return new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = src; s.onload = function () { res(src); }; s.onerror = function () { rej(new Error('chargement ' + src)); };
    document.head.appendChild(s);
  });
}
function __loadCss(href) {
  var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}
function __loadFirst(urls) {
  var i = 0;
  function next(err) {
    if (i >= urls.length) return Promise.reject(err || new Error('aucune source'));
    return __loadScript(urls[i++]).catch(next);
  }
  return next();
}
`;
