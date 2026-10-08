import { ASSET_BASE, CDN, LOAD_SCRIPT_HELPER, LOCAL } from '../../engine/assets';

const KATEX_LOCAL = ASSET_BASE + LOCAL.katex;

/** Page KaTeX : formule (display) ou texte avec $…$ (text). KaTeX lu dans l'APK, CDN en secours. */
export function buildMathHtml(math: string, mode: 'display' | 'text', color: string, fontSize: number): string {
    const payload = JSON.stringify({ math: math || '', mode }).replace(/<\//g, '<\\/');
    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${KATEX_LOCAL}katex.min.css" />
<script>${LOAD_SCRIPT_HELPER}</script>
<style>
  html, body { margin: 0; padding: 0; background: transparent; color: ${color}; font-size: ${fontSize}px;
    font-family: -apple-system, Roboto, sans-serif; }
  #t { padding: 4px 2px; overflow-x: auto; overflow-y: hidden; }
  #t.display { text-align: center; }
  #t.text { line-height: 1.45; font-size: ${Math.round(fontSize * 0.8)}px; white-space: pre-wrap; }
  .katex-display { margin: 0.2em 0; }
</style></head><body><div id="t"></div>
<script>
  var P = ${payload};
  var el = document.getElementById('t');
  el.className = P.mode;
  el.textContent = P.math;
  // KaTeX embarqué dans l'APK, CDN en secours
  __loadFirst(['${KATEX_LOCAL}katex.min.js', '${CDN.katex}katex.min.js']).then(function (src) {
    var base = src.replace(/katex\.min\.js$/, '');
    if (src.indexOf('file:') !== 0) __loadCss(base + 'katex.min.css');
    if (P.mode === 'display') {
      katex.render(P.math, el, { throwOnError: false, displayMode: true });
      report();
      return;
    }
    return __loadScript(base + 'contrib/auto-render.min.js').then(function () {
      renderMathInElement(el, { delimiters: [
        { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
        { left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true } ],
        throwOnError: false });
      report();
    });
  }).catch(function () { el.textContent = P.math; report(); });
  function report() { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(String(Math.ceil(el.getBoundingClientRect().height))); }
  report(); setTimeout(report, 150); setTimeout(report, 600);
</script></body></html>`;
}

