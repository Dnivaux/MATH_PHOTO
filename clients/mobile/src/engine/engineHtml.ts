/**
 * Page HTML chargée dans la WebView cachée du moteur embarqué.
 *
 *  - CortexJS Compute Engine : parsing/validation du LaTeX et calcul exact des cas simples
 *  - Pyodide + SymPy (Web Worker) : exécution du code SymPy des gabarits
 *  - OCR Texo (transformers.js / onnxruntime-web) : photo -> LaTeX, sur le téléphone
 *
 * Les bibliothèques et le modèle OCR sont lus dans l'APK (assets/engine/),
 * avec repli sur le CDN si un fichier manque.
 *
 * Protocole :
 *   RN -> page  : window.__engine.request(id, method, params)
 *   page -> RN  : {type:'response', id, ok, data|error} et {type:'status', ...}
 */
import { RUNNER_SOURCE } from './runnerSource';
import { OCR_MODEL, OCR_MODEL_MIRROR, OCR_MODULE_SOURCE, OcrModelConfig } from './ocrSource';
import { ASSET_BASE, CDN, FETCH_SHIM, LOAD_SCRIPT_HELPER, LOCAL, VERSIONS } from './assets';

export const CORTEX_VERSION = VERSIONS.cortex;
export const PYODIDE_VERSION = VERSIONS.pyodide;

export interface EngineHtmlConfig {
  /** Dossier des fichiers embarqués (null : CDN uniquement) */
  assetBase: string | null;
  cdn: { cortex: string; pyodide: string; transformers: string };
  /** false uniquement pour les tests (paquets servis localement sans hash officiel) */
  checkIntegrity: boolean;
  /** Sources distantes du modèle OCR, essayées après le modèle embarqué */
  ocrRemoteSources: OcrModelConfig[];
}

export const DEFAULT_ENGINE_CONFIG: EngineHtmlConfig = {
  assetBase: ASSET_BASE,
  cdn: { cortex: CDN.cortex, pyodide: CDN.pyodide, transformers: CDN.transformers },
  checkIntegrity: true,
  ocrRemoteSources: [OCR_MODEL, OCR_MODEL_MIRROR],
};

/** Code commun au Worker et au mode de secours sur le thread principal */
const PY_CORE = String.raw`
var __py = null;
async function pyInit(cfg, loadScript, post) {
  var t0 = Date.now();
  post({ type: 'status', python: 'loading' });
  await loadScript(cfg.indexURL + 'pyodide.js');
  __py = await loadPyodide({ indexURL: cfg.indexURL });
  await __py.loadPackage(['sympy'], { checkIntegrity: cfg.checkIntegrity });
  __py.runPython(cfg.runner);
  __py.runPython('import sympy');
  post({ type: 'status', python: 'ready', pythonLoadMs: Date.now() - t0, pythonSource: cfg.indexURL.indexOf('file:') === 0 ? 'apk' : 'cdn' });
}
async function pyRun(msg) {
  var fn = __py.globals.get('run_user_code');
  var out = fn(msg.code, !!msg.plot);
  if (fn.destroy) fn.destroy();
  return out;
}
`;

const WORKER_SOURCE = String.raw`
${FETCH_SHIM}
${PY_CORE}
var __ready = null;
self.onmessage = function (ev) {
  var m = ev.data;
  var post = function (x) { self.postMessage(x); };
  if (m.type === 'init') {
    self.__baseURI = m.cfg.indexURL;
    __ready = pyInit(m.cfg, function (url) { importScripts(url); return Promise.resolve(); }, post)
      .catch(function (e) { post({ type: 'worker-failed', error: String(e) }); throw e; });
    return;
  }
  if (m.type === 'run') {
    __ready.then(function () { return pyRun(m); })
      .then(function (out) { post({ type: 'run-result', id: m.id, out: out }); })
      .catch(function (e) { post({ type: 'run-result', id: m.id, error: String(e) }); });
  }
};
`;

export function buildEngineHtml(cfg: EngineHtmlConfig = DEFAULT_ENGINE_CONFIG): string {
  const local = (p: string) => (cfg.assetBase ? cfg.assetBase + p : null);
  const boot = {
    local: {
      cortex: local(LOCAL.cortex),
      pyodide: local(LOCAL.pyodide),
      transformers: local(LOCAL.transformers),
    },
    cdn: cfg.cdn,
    checkIntegrity: cfg.checkIntegrity,
    runner: RUNNER_SOURCE,
    ocrSources: [
      ...(cfg.assetBase
        ? [{ model: 'texo', remoteHost: cfg.assetBase + LOCAL.ocrModels, remotePathTemplate: '{model}/', local: true }]
        : []),
      ...cfg.ocrRemoteSources,
    ],
  };
  // </script> ne doit jamais apparaître tel quel dans le JSON injecté
  const safeJson = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<script>${FETCH_SHIM}</script>
<script>${LOAD_SCRIPT_HELPER}</script>
</head><body>
<script>
(function () {
  var BOOT = ${safeJson(boot)};
  var WORKER_SRC = ${safeJson(WORKER_SOURCE)};
  var PY_CORE = ${safeJson(PY_CORE)};

  function post(msg) {
    var s = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    if (window.__engineListener) window.__engineListener(msg);
  }
  window.__enginePost = post;
  window.__OCR_CFG = { local: BOOT.local.transformers, cdn: BOOT.cdn.transformers, sources: BOOT.ocrSources };

  // ---------- OCR (module ES, voir ocrSource.ts) ----------
  var ocrModule = new Promise(function (resolve, reject) {
    window.__resolveOcrModule = resolve;
    window.__rejectOcrModule = reject;
  });
  ocrModule.catch(function (e) { post({ type: 'status', ocr: 'error', error: 'OCR : ' + String(e) }); });
  function ocrInit() { return ocrModule.then(function (m) { return m.init(); }).then(function () { return true; }); }
  function ocr(p) { return ocrModule.then(function (m) { return m.recognize(p); }); }

  // ---------- CortexJS ----------
  var ce = null;
  var cortexReady = __loadFirst([BOOT.local.cortex, BOOT.cdn.cortex].filter(Boolean)).then(function (src) {
    ce = new window.ComputeEngine.ComputeEngine();
    post({ type: 'status', cortex: 'ready', cortexSource: src.indexOf('file:') === 0 ? 'apk' : 'cdn' });
  }).catch(function (e) {
    post({ type: 'status', cortex: 'error', error: String(e) });
    throw e;
  });

  function cleanLatex(s) {
    return String(s)
      .replace(/\\\\exponentialE/g, 'e')
      .replace(/\\\\imaginaryI/g, 'i')
      .replace(/\\\\operatorname\\{([a-z]+)\\}/g, '\\\\$1');
  }

  function parse(p) {
    return cortexReady.then(function () {
      var e = ce.parse(p.latex);
      return { json: e.json, isValid: e.isValid, latex: e.latex };
    });
  }

  function evaluate(p) {
    return cortexReady.then(function () {
      var e = ce.parse(p.latex);
      if (!e.isValid) throw new Error('LaTeX invalide');
      var exact = e.evaluate();
      var numeric = e.N();
      return {
        exactLatex: cleanLatex(exact.latex),
        numericLatex: cleanLatex(numeric.latex),
        exactIsNumber: !!exact.isNumberLiteral,
        numericIsNumber: !!numeric.isNumberLiteral,
        approximate: /\\\\pm/.test(numeric.latex),
      };
    });
  }

  // ---------- Pyodide (Worker, secours sur le thread principal) ----------
  var worker = null;
  var pending = {};
  var mainReady = null;
  var pyCfg = null;

  function onPyMessage(m) {
    if (m.type === 'status') { post(m); return; }
    if (m.type === 'worker-failed') { startMainThread(m.error); return; }
    if (m.type === 'run-result') {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(JSON.parse(m.out));
    }
  }

  function startMainThread(reason) {
    if (worker) { worker.terminate(); worker = null; }
    post({ type: 'status', pythonMode: 'main-thread', warning: String(reason || '') });
    (0, eval)(PY_CORE);
    mainReady = window.pyInit(pyCfg, __loadScript, onPyMessage);
    mainReady.catch(function (err) { post({ type: 'status', python: 'error', error: String(err) }); });
    // les requêtes en attente partent sur le thread principal
    for (var id in pending) { runOnMain(pending[id].msg); }
  }

  function startWorker() {
    try {
      var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (ev) { onPyMessage(ev.data); };
      worker.onerror = function (ev) { startMainThread('worker: ' + (ev.message || 'erreur')); };
      worker.postMessage({ type: 'init', cfg: pyCfg });
      post({ type: 'status', pythonMode: 'worker' });
    } catch (e) {
      startMainThread(e);
    }
  }

  function runOnMain(msg) {
    mainReady.then(function () { return window.pyRun(msg); })
      .then(function (out) { onPyMessage({ type: 'run-result', id: msg.id, out: out }); })
      .catch(function (e) { onPyMessage({ type: 'run-result', id: msg.id, error: String(e) }); });
  }

  // Pyodide embarqué si présent, sinon CDN
  var pyStarted = (BOOT.local.pyodide ? window.__exists(BOOT.local.pyodide + 'pyodide.js') : Promise.resolve(false))
    .then(function (ok) {
      pyCfg = { indexURL: ok ? BOOT.local.pyodide : BOOT.cdn.pyodide, checkIntegrity: BOOT.checkIntegrity, runner: BOOT.runner };
      startWorker();
    });

  function runPython(p) {
    var id = String(Date.now()) + Math.random();
    var timeoutMs = p.timeoutMs || 30000;
    var msg = { type: 'run', id: id, code: p.code, plot: !!p.plot };
    return pyStarted.then(function () {
      return new Promise(function (resolve, reject) {
        var entry = { resolve: resolve, reject: reject, timer: null, msg: msg };
        entry.timer = setTimeout(function () {
          delete pending[id];
          if (worker) {
            // Code bloqué : on tue le worker et on en relance un propre
            worker.terminate();
            for (var k in pending) { clearTimeout(pending[k].timer); pending[k].reject(new Error('Python redémarré')); }
            pending = {};
            post({ type: 'status', python: 'restarting' });
            startWorker();
          }
          reject(new Error('Délai dépassé (' + Math.round(timeoutMs / 1000) + ' s)'));
        }, timeoutMs);
        pending[id] = entry;
        if (worker) worker.postMessage(msg);
        else runOnMain(msg);
      });
    });
  }

  var methods = {
    parse: parse, evaluate: evaluate, runPython: runPython, ocr: ocr, ocrInit: ocrInit,
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
<script type="module">
try {
${OCR_MODULE_SOURCE}
} catch (e) {
  window.__rejectOcrModule && window.__rejectOcrModule(e);
}
</script>
</body></html>`;
}
