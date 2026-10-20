/**
 * Fichiers embarqués dans l'APK (android/app/src/main/assets/engine/), copiés par `npm run engine-assets`
 * depuis node_modules et depuis l'export ONNX de pix2tex. Les WebView sont chargées avec ce dossier comme
 * baseUrl : tout fonctionne hors ligne, et aucune page ne charge de script distant.
 */
export const ASSET_BASE = 'file:///android_asset/engine/';

export const VERSIONS = {
  cortex: '0.30.2',
  ort: '1.18.0',
  katex: '0.16.11',
  mathlive: '0.107.1',
};

/** Chemins relatifs à ASSET_BASE */
export const LOCAL = {
  cortex: 'cortex/compute-engine.min.umd.js',
  ort: 'ort/',
  katex: 'katex/',
  mathlive: 'mathlive/',
  fonts: 'fonts/',
  ocr: 'models/pix2tex/',
};

/**
 * Props des WebView qui lisent les fichiers embarqués. L'accès universel depuis file:// reste coupé :
 * les pages ne lisent que leurs propres fichiers (fetch() réécrit en XMLHttpRequest file://).
 */
export const FILE_ACCESS_PROPS = {
  allowFileAccess: true,
  allowFileAccessFromFileURLs: true,
  allowUniversalAccessFromFileURLs: false,
  originWhitelist: ['*'] as string[],
  setSupportMultipleWindows: false,
};

/**
 * fetch() ne sait pas lire file:// dans une WebView : on le remplace pour ces adresses par un
 * XMLHttpRequest (autorisé par allowFileAccessFromFileURLs). Les autres adresses sont refusées.
 */
export const FETCH_SHIM = String.raw`
(function (g) {
  if (g.__fetchShim) return;
  g.__fetchShim = true;
  var nativeFetch = g.fetch ? g.fetch.bind(g) : null;
  var TYPES = { wasm: 'application/wasm', js: 'text/javascript', json: 'application/json', css: 'text/css',
    onnx: 'application/octet-stream', woff2: 'font/woff2', txt: 'text/plain' };
  g.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var base = (g.document && g.document.baseURI) || '';
    var abs;
    try { abs = new URL(url, base).href; } catch (e) { abs = url; }
    if (abs.indexOf('file:') !== 0) {
      if (g.__allowNetwork && nativeFetch) return nativeFetch(input, init);
      return Promise.reject(new Error('accès réseau refusé : ' + abs));
    }
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest();
      x.open('GET', abs);
      x.responseType = 'arraybuffer';
      x.onload = function () {
        if ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength > 0) {
          var ext = abs.split('?')[0].split('.').pop().toLowerCase();
          resolve(new Response(x.response, { status: 200, headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream' } }));
        } else {
          resolve(new Response('', { status: 404 }));
        }
      };
      x.onerror = function () { resolve(new Response('', { status: 404 })); };
      x.send();
    });
  };
})(typeof self !== 'undefined' ? self : window);
`;

/** Polices de texte des pages (CMU Serif : Computer Modern, la police des formules, avec les accents) */
export function fontFaceCss(base: string = ASSET_BASE): string {
  const f = base + LOCAL.fonts;
  return `
@font-face { font-family: 'CMU Serif'; src: url('${f}cmu-serif-500-roman.woff2') format('woff2'); font-weight: 400; font-style: normal; }
@font-face { font-family: 'CMU Serif'; src: url('${f}cmu-serif-500-italic.woff2') format('woff2'); font-weight: 400; font-style: italic; }
@font-face { font-family: 'CMU Serif'; src: url('${f}cmu-serif-700-roman.woff2') format('woff2'); font-weight: 700; font-style: normal; }`;
}

/** Charge un script local (classique) et rejette s'il manque */
export const LOAD_SCRIPT_HELPER = String.raw`
function __loadScript(src) {
  return new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = src; s.onload = function () { res(src); }; s.onerror = function () { rej(new Error('fichier embarqué manquant : ' + src)); };
    document.head.appendChild(s);
  });
}
`;
