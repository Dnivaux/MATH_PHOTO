/**
 * Page HTML de la WebView cachée du moteur embarqué :
 *
 *  - CortexJS Compute Engine : validation du LaTeX, calcul exact des cas locaux, étapes, vérification
 *    des explications (mathSource.ts) ;
 *  - OCR pix2tex en ONNX INT8 sur onnxruntime-web (ocrSource.ts).
 *
 * Tout est lu dans l'APK. Protocole :
 *   RN -> page : window.__engine.request(id, method, params)
 *   page -> RN : { type: 'response', id, ok, data | error } et { type: 'status', ... }
 */
import { ASSET_BASE, FETCH_SHIM, LOAD_SCRIPT_HELPER, LOCAL } from './assets';
import { MATH_SOURCE } from './mathSource';
import { OCR_SOURCE } from './ocrSource';

export function buildEngineHtml(assetBase: string = ASSET_BASE): string {
  const boot = {
    cortex: assetBase + LOCAL.cortex,
    ort: assetBase + LOCAL.ort,
    ocr: assetBase + LOCAL.ocr,
  };
  const safeJson = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<script>${FETCH_SHIM}</script>
<script>${LOAD_SCRIPT_HELPER}</script>
</head><body>
<script>
(function () {
  var BOOT = ${safeJson(boot)};
  // état courant de la page, réannoncé à la demande (window.__engineAnnounce)
  var STATUS = { type: 'status', page: 'ready' };
  function post(msg) {
    if (msg.type === 'status') { for (var k in msg) STATUS[k] = msg[k]; }
    var s = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    if (window.__engineListener) window.__engineListener(msg);
  }
  window.__enginePost = post;
  window.__engineAnnounce = function () { post(STATUS); };
  window.__OCR_BASE = BOOT.ocr;
  window.__ORT_BASE = BOOT.ort;

  ${MATH_SOURCE}
  ${OCR_SOURCE}

  var math = null;
  var cortexReady = __loadScript(BOOT.cortex).then(function () {
    var CE = window.ComputeEngine.ComputeEngine;
    math = makeMath(function () { return new CE(); });
    post({ type: 'status', cortex: 'ready' });
  }).catch(function (e) {
    post({ type: 'status', cortex: 'error', error: String(e && e.message || e) });
    throw e;
  });

  var ortReady = null;
  function ocrInit() {
    if (!ortReady) ortReady = __loadScript(BOOT.ort + 'ort.wasm.min.js');
    return ortReady.then(function () { return OCR.init(); });
  }

  function withMath(fn) { return function (p) { return cortexReady.then(function () { return fn(p || {}); }); }; }

  var methods = {
    analyze: withMath(function (p) { return math.analyze(p.latex); }),
    evaluate: withMath(function (p) { return math.evaluate(p.latex); }),
    isValid: withMath(function (p) { return math.isValid(p.latex); }),
    values: withMath(function (p) { return math.values(p.list); }),
    sameProblem: withMath(function (p) { return math.sameProblem(p.sent, p.received, p.type); }),
    checkExplanation: withMath(function (p) { return math.checkExplanation(p); }),
    ocrInit: function () { return ocrInit(); },
    ocr: function (p) { return ocrInit().then(function () { return OCR.recognize(p); }); },
    ping: function () { return 'pong'; },
  };

  window.__engine = {
    request: function (id, method, params) {
      Promise.resolve()
        .then(function () {
          if (!methods[method]) throw new Error('méthode inconnue ' + method);
          return methods[method](params || {});
        })
        .then(function (data) { post({ type: 'response', id: id, ok: true, data: data }); })
        .catch(function (e) { post({ type: 'response', id: id, ok: false, error: (e && e.message) || String(e) }); });
    },
  };

  post({ type: 'status', page: 'ready' });
})();
</script>
</body></html>`;
}
