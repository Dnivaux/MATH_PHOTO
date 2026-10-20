/**
 * Liste de l'historique dans une seule WebView (une WebView par formule serait trop lourde).
 * RN -> page : window.__list.set(items)     page -> RN : { type: 'ready' } | { type: 'open', id }
 */
import { ASSET_BASE, fontFaceCss, LOAD_SCRIPT_HELPER, LOCAL } from '../../engine/assets';
import type { WebColors } from '../../theme';

const PAGE_JS = String.raw`
var ready = __loadScript(KATEX + 'katex.min.js');
function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
function tex(el, l) { try { katex.render(l || '', el, { throwOnError: false, displayMode: false }); } catch (e) { el.textContent = l; } }
var CLOUD = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 9.04 5.2"/></svg>';
var ALERT = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
/** x ∈ {a ; b} -> x = a ou x = b ; sinon « = résultat » */
function readable(latex) {
  if (/^\\emptyset$|^\\varnothing$/.test(latex.trim())) return '\\text{Aucune solution réelle}';
  var m = latex.match(/^\s*([a-z])\s*\\in\s*\\left\\\{(.*)\\right\\\}\s*$/);
  if (!m) return '= ' + latex;
  return m[2].split(/\s*;\s*/).filter(Boolean).map(function (v) { return m[1] + ' = ' + v; }).join('\\quad\\text{ou}\\quad ');
}
function when(t) {
  var d = new Date(t), now = new Date();
  var hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Aujourd’hui, ' + hm;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ', ' + hm;
}
function set(items) {
  ready.then(function () {
    var ul = document.getElementById('list');
    ul.innerHTML = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.setAttribute('aria-label', 'Ouvrir : ' + it.latex);
      b.innerHTML = '<div class="f"></div><div class="r"></div><div class="m"></div>';
      tex(b.querySelector('.f'), it.latex);
      var r = b.querySelector('.r');
      if (it.status === 'pending') r.innerHTML = '<span class="pending">' + CLOUD + 'En attente du réseau</span>';
      else if (it.status === 'failed') r.innerHTML = '<span class="failed">' + ALERT + 'Non résolu</span>';
      else if (it.result) tex(r, readable(it.result));
      b.querySelector('.m').textContent = (it.kind ? it.kind + ' · ' : '') + when(it.at);
      b.onclick = function () { post({ type: 'open', id: it.id }); };
      li.appendChild(b);
      ul.appendChild(li);
    });
  });
}
window.__list = { set: set };
post({ type: 'ready' });
`;

export function buildHistoryHtml(c: WebColors, fontScale: number): string {
  const katex = ASSET_BASE + LOCAL.katex;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${katex}katex.min.css" />
<script>${LOAD_SCRIPT_HELPER}</script>
<style>
${fontFaceCss()}
* { box-sizing: border-box; }
html, body { margin: 0; background: ${c.bg}; color: ${c.text}; -webkit-tap-highlight-color: transparent; }
body { font: ${Math.round(16 * fontScale)}px/1.45 'CMU Serif', serif; }
ul { list-style: none; margin: 0; padding: 8px 0 32px; }
li { border-bottom: 1px solid ${c.line}; }
button { all: unset; display: block; width: 100%; padding: 14px 20px; min-height: 56px; box-sizing: border-box; }
button:active { background: ${c.surfaceAlt}; }
.f { font-size: 1.15em; overflow-x: auto; overflow-y: hidden; }
.r { color: ${c.primary}; margin-top: 2px; overflow-x: auto; overflow-y: hidden; }
.m { color: ${c.textMuted}; font: 13px/1.4 system-ui, Roboto, sans-serif; margin-top: 4px; }
.pending, .failed { display: inline-flex; gap: 6px; align-items: center; font: 500 14px system-ui, Roboto, sans-serif; }
.pending { color: ${c.textMuted}; } .failed { color: ${c.warning}; }
.ic { width: 16px; height: 16px; }
</style></head><body><ul id="list"></ul>
<script>var KATEX = ${JSON.stringify(katex)};
${PAGE_JS}</script></body></html>`;
}
