import { ASSET_BASE, fontFaceCss, LOAD_SCRIPT_HELPER, LOCAL } from '../../engine/assets';

const KATEX = ASSET_BASE + LOCAL.katex;

export interface MathHtmlOptions {
  math: string;
  mode: 'display' | 'text';
  color: string;
  /** taille en px CSS, déjà multipliée par l'échelle de police du téléphone */
  fontSize: number;
  align?: 'center' | 'left';
}

/** Page KaTeX : une formule (display) ou un texte avec $…$ (text, composé en CMU Serif). Tout est local. */
export function buildMathHtml({ math, mode, color, fontSize, align = 'center' }: MathHtmlOptions): string {
  const payload = JSON.stringify({ math: math || '', mode }).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${KATEX}katex.min.css" />
<script>${LOAD_SCRIPT_HELPER}</script>
<style>
  ${fontFaceCss()}
  html, body { margin: 0; padding: 0; background: transparent; color: ${color}; font-size: ${fontSize}px; }
  #t { padding: 4px 2px; overflow-x: auto; overflow-y: hidden; -webkit-tap-highlight-color: transparent; }
  #t.display { text-align: ${align}; }
  #t.text { font-family: 'CMU Serif', serif; line-height: 1.5; white-space: pre-wrap; text-align: left; }
  .katex-display { margin: 0.15em 0; }
  .katex { font-size: 1.12em; }
</style></head><body><div id="t"></div>
<script>
  var P = ${payload};
  var el = document.getElementById('t');
  el.className = P.mode;
  el.textContent = P.math;
  function report() { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(String(Math.ceil(el.getBoundingClientRect().height))); }
  __loadScript('${KATEX}katex.min.js').then(function () {
    if (P.mode === 'display') {
      katex.render(P.math, el, { throwOnError: false, displayMode: true });
      report();
      return;
    }
    return __loadScript('${KATEX}contrib/auto-render.min.js').then(function () {
      renderMathInElement(el, { delimiters: [
        { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
        { left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true } ],
        throwOnError: false });
      report();
    });
  }).catch(function () { el.textContent = P.math; report(); });
  report(); setTimeout(report, 150); setTimeout(report, 600);
</script></body></html>`;
}
