/**
 * Page de solution, composée comme une page de manuel dans une seule WebView : énoncé, résultat encadré
 * (comme on encadre la réponse sur une copie), démarche reliée par un fil, graphe interactif, explication.
 * Texte en CMU Serif (Computer Modern, la police des formules), formules en KaTeX, tout lu dans l'APK.
 *
 * RN -> page : window.__doc.set(state)       page -> RN : { type: 'ready' } | { type: 'action', action, ... }
 * Le graphe est calculé sur le téléphone : CortexJS compile chaque courbe en fonction JavaScript.
 */
import { ASSET_BASE, fontFaceCss, LOAD_SCRIPT_HELPER, LOCAL } from '../../engine/assets';
import type { WebColors } from '../../theme';

const PAGE_JS = String.raw`
var KATEX_READY = __loadScript(BASE.katex + 'katex.min.js').then(function () { return __loadScript(BASE.katex + 'contrib/auto-render.min.js'); });
var CORTEX = null;
function cortex() {
  if (!CORTEX) CORTEX = __loadScript(BASE.cortex).then(function () { return new window.ComputeEngine.ComputeEngine(); });
  return CORTEX;
}
function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }

var ICONS = {
  check: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  stop: '<rect width="12" height="12" x="6" y="6" rx="2"/>',
  retry: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  cloud: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 9.04 5.2"/>',
};
function icon(name, cls) {
  return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function tex(el, latex, display) {
  try { katex.render(latex || '', el, { throwOnError: false, displayMode: display !== false }); } catch (e) { el.textContent = latex; }
  if (display !== false) fit(el);
}
/** Une formule plus large que la colonne est réduite (jusqu'à 70 %), puis défile si besoin */
function fit(el) {
  var k = el.querySelector('.katex-display') || el;
  el.style.fontSize = '';
  var w = k.clientWidth, sw = k.scrollWidth;
  if (w > 0 && sw > w + 1) el.style.fontSize = Math.max(0.7, (w - 2) / sw) + 'em';
}
window.addEventListener('resize', function () { document.querySelectorAll('.formula').forEach(fit); });
function prose(el, text) {
  el.textContent = text || '';
  try {
    renderMathInElement(el, { throwOnError: false, delimiters: [
      { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true } ] });
  } catch (e) {}
}
/** Pendant la rédaction : on retient une formule ouverte ($ ou $$) jusqu'à sa fermeture, plutôt que d'afficher du LaTeX brut */
function closedPrefix(text) {
  var parts = text.split('$$');
  if (parts.length % 2 === 0) text = text.slice(0, text.lastIndexOf('$$'));
  var singles = [], i = 0;
  while (i < text.length) {
    if (text[i] === '$') { if (text[i + 1] === '$') { i += 2; continue; } singles.push(i); }
    i++;
  }
  return singles.length % 2 === 1 ? text.slice(0, singles[singles.length - 1]) : text;
}

/** Texte long : un paragraphe par ligne vide, sans les blancs qu'ajoutent les retours à la ligne autour des formules centrées */
function paragraphs(el, text) {
  el.innerHTML = '';
  String(text || '').replace(/\s*(\$\$[\s\S]+?\$\$)\s*/g, '\n\n$1\n\n').split(/\n\s*\n/).forEach(function (p) {
    p = p.trim();
    if (!p) return;
    var e = document.createElement('p');
    prose(e, p.replace(/\s*\n\s*/g, ' '));
    el.appendChild(e);
  });
}
function button(action, label, iconName, variant, extra) {
  return '<button class="btn ' + (variant || 'tonal') + '" data-action="' + action + '"' + (extra || '') + '>' + (iconName ? icon(iconName) : '') + '<span>' + esc(label) + '</span></button>';
}

var doc = document.getElementById('doc');
var cache = {};
var state = null;

doc.addEventListener('click', function (e) {
  var b = e.target.closest('[data-action]');
  if (!b) return;
  post({ type: 'action', action: b.getAttribute('data-action'), value: b.getAttribute('data-value') });
});

function section(id, key, build) {
  var el = document.getElementById(id);
  if (!el) { el = document.createElement('section'); el.id = id; doc.appendChild(el); }
  if (cache[id] === key) return el;
  cache[id] = key;
  build(el);
  return el;
}

function removeSection(id) { var el = document.getElementById(id); if (el) el.remove(); delete cache[id]; }

function renderStatement(s) {
  section('statement', JSON.stringify([s.latex, s.kindLabel]), function (el) {
    el.className = 'statement';
    el.innerHTML = '<h1 class="sr">Énoncé</h1><div class="formula big"></div><p class="kind"></p>';
    tex(el.querySelector('.formula'), s.latex);
    el.querySelector('.kind').textContent = s.kindLabel || '';
  });
}

function renderLoading(s) {
  removeSection('result'); removeSection('steps'); removeSection('graph'); removeSection('explain'); removeSection('notes'); removeSection('error');
  section('loading', s.progress, function (el) {
    el.className = 'loading';
    el.innerHTML = '<div class="skeleton frame"></div><div class="skeleton line"></div><div class="skeleton line short"></div><p class="muted" role="status"></p>';
    el.querySelector('p').textContent = s.progress || 'Calcul…';
  });
}

function renderError(s) {
  removeSection('loading'); removeSection('result'); removeSection('steps'); removeSection('graph'); removeSection('explain'); removeSection('notes');
  section('error', JSON.stringify(s.error), function (el) {
    var e = s.error;
    el.className = 'error';
    el.innerHTML = '<div class="callout ' + (e.queued ? 'info' : 'warn') + '" role="alert">' + icon(e.queued ? 'cloud' : 'alert') +
      '<div><h2></h2><p></p></div></div><div class="actions"></div>';
    el.querySelector('h2').textContent = e.title;
    el.querySelector('p').textContent = e.message;
    var a = '';
    if (e.canEdit) a += button('edit', 'Corriger la formule', 'pencil', 'outlined');
    if (e.canRetry) a += button('retry', 'Réessayer', 'retry', 'filled');
    el.querySelector('.actions').innerHTML = a;
  });
}

/** Forme lisible d'un ensemble de solutions : x ∈ {a ; b} -> x = a ou x = b (le LaTeX d'origine reste celui du prompt) */
function readable(latex) {
  if (/^\\emptyset$|^\\varnothing$/.test(latex.trim())) return '\\text{Aucune solution réelle}';
  var m = latex.match(/^\s*([a-z])\s*\\in\s*\\left\\\{(.*)\\right\\\}\s*$/);
  if (!m) return latex;
  var vals = m[2].split(/\s*;\s*/).filter(Boolean);
  return vals.map(function (v) { return m[1] + ' = ' + v; }).join('\\quad\\text{ou}\\quad ');
}

function renderResult(sol) {
  section('result', JSON.stringify([sol.result, sol.verified, sol.route, sol.status]), function (el) {
    el.className = 'result';
    var status;
    if (sol.verified && sol.route === 'local') status = '<p class="status ok">' + icon('check') + '<span>Calcul exact, fait sur ton téléphone</span></p>';
    else if (sol.verified) status = '<p class="status ok">' + icon('check') + '<span>Calculé par le serveur et vérifié deux fois</span></p>';
    else status = '<p class="status warn">' + icon('alert') + '<span>Résultat non confirmé : le serveur n’a pas pu le vérifier par une seconde méthode</span></p>';
    el.innerHTML = '<h2 class="sr">Résultat</h2><div class="boxed"><div class="formula answer"></div><div class="formula approx"></div></div>' + status;
    if (sol.result) tex(el.querySelector('.answer'), readable(sol.result.latex));
    var ap = el.querySelector('.approx');
    if (sol.result && sol.result.numeric) tex(ap, sol.result.numeric.indexOf('\\approx') >= 0 ? sol.result.numeric : '\\approx ' + sol.result.numeric);
    else ap.remove();
  });
}

function renderSteps(sol) {
  if (!sol.steps || !sol.steps.length) { removeSection('steps'); return; }
  section('steps', JSON.stringify(sol.steps), function (el) {
    el.className = 'steps';
    var html = '<h2>Démarche</h2><ol class="rail">';
    sol.steps.forEach(function (st, i) {
      html += '<li><span class="node" aria-hidden="true">' + (i + 1) + '</span><div class="step"><p class="text"></p>' + (st.latex ? '<div class="formula"></div>' : '') + '</div></li>';
    });
    el.innerHTML = html + '</ol>';
    var items = el.querySelectorAll('li');
    sol.steps.forEach(function (st, i) {
      prose(items[i].querySelector('.text'), st.text_fr);
      if (st.latex) tex(items[i].querySelector('.formula'), st.latex);
    });
  });
}

// ------------------------------------------------------------------ graphe

var graph = null;
function renderGraph(sol) {
  if (!sol.plot || !sol.plot.curves || !sol.plot.curves.length) { removeSection('graph'); graph = null; return; }
  section('graph', JSON.stringify(sol.plot), function (el) {
    el.className = 'graph';
    el.innerHTML = '<h2>Graphe</h2><div class="plot"><canvas aria-label="Graphe des courbes" role="img"></canvas>' +
      '<div class="legend"></div><div class="tip" aria-live="polite"></div><div class="zoom">' +
      '<button class="round" data-g="in" aria-label="Zoomer">' + icon('plus') + '</button>' +
      '<button class="round" data-g="out" aria-label="Dézoomer">' + icon('minus') + '</button>' +
      '<button class="round" data-g="reset" aria-label="Vue initiale">' + icon('reset') + '</button></div></div>' +
      '<p class="muted small">Glisse pour te déplacer, pince pour zoomer, touche la courbe pour lire une valeur.</p>';
    cortex().then(function (ce) { graph = makeGraph(el, sol.plot, ce); }).catch(function () { el.remove(); });
  });
}

function makeGraph(el, P, ce) {
  var canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1, W = 0, H = 0;
  var fns = [];
  P.curves.forEach(function (cv, i) {
    try {
      var e = ce.parse(cv.latex);
      if (!e.isValid) return;
      var f = e.compile();
      if (typeof f !== 'function') return;
      var test = f(Object.fromEntries([[P.var, 1.234]]));
      if (typeof test !== 'number') return;
      fns.push({ f: function (x) { var o = {}; o[P.var] = x; return f(o); }, label: cv.label, color: COLORS.series[fns.length % COLORS.series.length], dash: fns.length % 2 === 1 });
    } catch (err) {}
  });
  if (!fns.length) { el.remove(); return null; }
  var legend = el.querySelector('.legend');
  if (fns.length > 1) legend.innerHTML = fns.map(function (f) { return '<div><i style="background:' + f.color + (f.dash ? ';background-image:repeating-linear-gradient(90deg,' + f.color + ' 0 5px,transparent 5px 8px);background-color:transparent' : '') + '"></i>' + esc(f.label) + '</div>'; }).join('');
  else legend.remove();
  var tip = el.querySelector('.tip');
  var points = (P.points || []).map(function (p) { return { label: p.label, x: p.x, y: isFinite(p.y) ? p.y : val(fns[0], p.x) }; });
  var view = initialView(), trace = null;
  function val(fn, x) { try { var y = fn.f(x); return typeof y === 'number' && isFinite(y) ? y : NaN; } catch (e) { return NaN; } }
  function initialView() {
    var xs = points.map(function (p) { return p.x; }).filter(isFinite);
    var x0 = -5, x1 = 5;
    if (xs.length) { var mn = Math.min.apply(null, xs), mx = Math.max.apply(null, xs); var span = Math.max(6, (mx - mn) * 1.6); x0 = (mn + mx) / 2 - span / 2 - 1; x1 = (mn + mx) / 2 + span / 2 + 1; }
    var ys = [];
    for (var i = 0; i <= 400; i++) { var x = x0 + (x1 - x0) * i / 400; fns.forEach(function (fn) { var y = val(fn, x); if (!isNaN(y)) ys.push(y); }); }
    points.forEach(function (p) { if (isFinite(p.y)) ys.push(p.y); });
    ys.sort(function (a, b) { return a - b; });
    var y0 = -10, y1 = 10;
    if (ys.length) {
      // fenêtre verticale sur le gros des valeurs (une exponentielle ou une asymptote n'écrase pas tout)
      y0 = ys[Math.floor(ys.length * 0.08)]; y1 = ys[Math.floor(ys.length * 0.85)];
      var pad = Math.max((y1 - y0) * 0.25, 1); y0 -= pad; y1 += pad;
      if (y0 > 0) y0 = Math.min(y0, -pad * 0.5); if (y1 < 0) y1 = Math.max(y1, pad * 0.5);
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }
  function sx(x) { return (x - view.x0) / (view.x1 - view.x0) * W; }
  function sy(y) { return H - (y - view.y0) / (view.y1 - view.y0) * H; }
  function wx(px) { return view.x0 + px / W * (view.x1 - view.x0); }
  function wy(py) { return view.y0 + (H - py) / H * (view.y1 - view.y0); }
  function step(range, target) { var raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  function fmt(v, s) { if (Math.abs(v) < s * 1e-6) return '0'; var d = Math.max(0, -Math.floor(Math.log10(s))); var t = Math.abs(v) >= 1e5 ? v.toExponential(1) : v.toFixed(Math.min(d, 6)); return t.replace('.', ','); }
  function num(v) { return String(+v.toPrecision(5)).replace('.', ','); }
  function resize() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var gxS = step(view.x1 - view.x0, W / 70), gyS = step(view.y1 - view.y0, H / 55);
    ctx.lineWidth = 1; ctx.strokeStyle = COLORS.grid; ctx.beginPath();
    for (var gx = Math.ceil(view.x0 / gxS) * gxS; gx <= view.x1; gx += gxS) { ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), H); }
    for (var gy = Math.ceil(view.y0 / gyS) * gyS; gy <= view.y1; gy += gyS) { ctx.moveTo(0, sy(gy)); ctx.lineTo(W, sy(gy)); }
    ctx.stroke();
    var ax = Math.min(Math.max(sy(0), 0), H), ay = Math.min(Math.max(sx(0), 0), W);
    ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, ax); ctx.lineTo(W, ax); ctx.moveTo(ay, 0); ctx.lineTo(ay, H); ctx.stroke();
    ctx.fillStyle = COLORS.label; ctx.font = Math.round(11 * SCALE) + 'px "CMU Serif", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (gx = Math.ceil(view.x0 / gxS) * gxS; gx <= view.x1; gx += gxS) { if (Math.abs(gx) < gxS / 2) continue; ctx.fillText(fmt(gx, gxS), sx(gx), Math.min(ax + 3, H - 14)); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (gy = Math.ceil(view.y0 / gyS) * gyS; gy <= view.y1; gy += gyS) { if (Math.abs(gy) < gyS / 2) continue; ctx.fillText(fmt(gy, gyS), Math.max(ay - 4, 30), sy(gy)); }
    fns.forEach(function (fn) {
      ctx.strokeStyle = fn.color; ctx.lineWidth = 2.4; ctx.setLineDash(fn.dash ? [7, 5] : []); ctx.beginPath();
      var started = false, prev = NaN;
      for (var px = 0; px <= W; px += 1) {
        var y = val(fn, wx(px)), py = sy(y);
        if (isNaN(y) || Math.abs(py) > 1e5 || (!isNaN(prev) && Math.abs(py - prev) > H * 2)) { started = false; prev = NaN; continue; }
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        prev = py;
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
    points.forEach(function (p) { if (!isFinite(p.y)) return; ctx.fillStyle = COLORS.point; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 5, 0, 2 * Math.PI); ctx.fill(); });
    if (trace !== null) {
      var y = val(fns[0], trace);
      if (!isNaN(y)) {
        ctx.strokeStyle = COLORS.axis; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(sx(trace), 0); ctx.lineTo(sx(trace), H); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = fns[0].color; ctx.beginPath(); ctx.arc(sx(trace), sy(y), 5.5, 0, 2 * Math.PI); ctx.fill();
        tip.style.display = 'block'; tip.textContent = P.var + ' = ' + num(trace) + '   y = ' + num(y);
      } else tip.style.display = 'none';
    } else tip.style.display = 'none';
  }
  function zoom(f, cx, cy) { var X = wx(cx), Y = wy(cy); view = { x0: X - (X - view.x0) * f, x1: X + (view.x1 - X) * f, y0: Y - (Y - view.y0) * f, y1: Y + (view.y1 - Y) * f }; draw(); }
  var ptrs = {}, last = null, moved = false, lastTap = 0;
  canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.offsetX, y: e.offsetY }; moved = false; last = null; });
  canvas.addEventListener('pointermove', function (e) {
    if (!ptrs[e.pointerId]) return;
    var ids = Object.keys(ptrs), prevP = ptrs[e.pointerId];
    ptrs[e.pointerId] = { x: e.offsetX, y: e.offsetY };
    if (ids.length === 1) {
      var dx = e.offsetX - prevP.x, dy = e.offsetY - prevP.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      var kx = (view.x1 - view.x0) / W, ky = (view.y1 - view.y0) / H;
      view.x0 -= dx * kx; view.x1 -= dx * kx; view.y0 += dy * ky; view.y1 += dy * ky; draw();
    } else if (ids.length >= 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (last && d > 0) zoom(last.d / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      last = { d: d }; moved = true;
    }
  });
  function up(e) {
    var single = Object.keys(ptrs).length === 1;
    delete ptrs[e.pointerId];
    if (Object.keys(ptrs).length < 2) last = null;
    if (single && !moved) {
      var now = Date.now();
      if (now - lastTap < 300) { view = initialView(); trace = null; draw(); } else { trace = wx(e.offsetX); draw(); }
      lastTap = now;
    }
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  el.querySelector('[data-g="in"]').onclick = function () { zoom(1 / 1.5, W / 2, H / 2); };
  el.querySelector('[data-g="out"]').onclick = function () { zoom(1.5, W / 2, H / 2); };
  el.querySelector('[data-g="reset"]').onclick = function () { view = initialView(); trace = null; draw(); };
  window.addEventListener('resize', resize);
  resize();
  return { draw: draw };
}

// ------------------------------------------------------------------ explication

function renderExplain(s) {
  var x = s.explain;
  if (!x) { removeSection('explain'); return; }
  var el = section('explain', 'shell', function (el) {
    el.className = 'explain';
    el.innerHTML = '<div class="explain-head"><h2>Explication</h2><div class="levels" role="radiogroup" aria-label="Niveau de l’explication"></div></div>' +
      '<div class="explain-state"></div><div class="explain-text" aria-live="polite"></div><div class="explain-foot"></div>';
  });
  var levels = el.querySelector('.levels');
  var lk = JSON.stringify([x.level, x.status === 'loading' || x.status === 'streaming', x.status === 'unavailable']);
  if (levels.getAttribute('data-k') !== lk) {
    levels.setAttribute('data-k', lk);
    levels.innerHTML = x.status === 'unavailable' ? '' : s.levels.map(function (l) {
      var on = l.id === x.level;
      return '<button class="chip' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-action="level" data-value="' + l.id + '"' +
        (x.status === 'loading' || x.status === 'streaming' ? ' disabled' : '') + '>' + esc(l.label) + '</button>';
    }).join('');
  }
  var st = el.querySelector('.explain-state');
  var sk = JSON.stringify([x.status, x.via, x.message, x.action]);
  if (st.getAttribute('data-k') !== sk) {
    st.setAttribute('data-k', sk);
    var h = '';
    if (x.status === 'loading') h = '<p class="muted" role="status"><span class="spinner" aria-hidden="true"></span>' + (x.via === 'device' ? 'Rédaction sur ton téléphone…' : 'Rédaction par le serveur…') + '</p>';
    else if (x.status === 'unavailable' || x.status === 'error') {
      h = '<div class="callout ' + (x.status === 'error' ? 'warn' : 'info') + '">' + icon(x.status === 'error' ? 'alert' : 'info') + '<div><p>' + esc(x.message) + '</p>' +
        (x.action ? '<div class="actions">' + button(x.action.id, x.action.label, x.action.icon, 'tonal') + '</div>' : '') + '</div></div>';
    }
    st.innerHTML = h;
  }
  var tx = el.querySelector('.explain-text');
  var text = x.text || '';
  if (tx.getAttribute('data-t') !== text + x.status) {
    tx.setAttribute('data-t', text + x.status);
    paragraphs(tx, x.status === 'streaming' ? closedPrefix(text) : text);
    if (x.status === 'streaming') { var caret = document.createElement('span'); caret.className = 'caret'; caret.setAttribute('aria-hidden', 'true'); (tx.lastElementChild || tx).appendChild(caret); }
  }
  var foot = el.querySelector('.explain-foot');
  var fk = JSON.stringify([x.status, x.report, x.via]);
  if (foot.getAttribute('data-k') !== fk) {
    foot.setAttribute('data-k', fk);
    var f = '';
    if (x.status === 'streaming') f = '<div class="actions">' + button('stop', 'Arrêter', 'stop', 'outlined') + '</div>';
    if (x.status === 'done') {
      var r = x.report, src = x.via === 'device' ? 'Rédigée sur ton téléphone' : 'Rédigée par le serveur';
      if (r && r.accept) f = '<p class="status ok">' + icon('check') + '<span>' + src + ' · chaque égalité a été revérifiée</span></p>';
      else if (r && (r.fail > 0 || r.hallucinated.length)) {
        f = '<div class="callout warn">' + icon('alert') + '<div><p>Prudence : ' +
          (r.fail > 0 ? (r.fail === 1 ? 'une égalité de ce texte est fausse' : r.fail + ' égalités de ce texte sont fausses') : 'ce texte cite des nombres absents des étapes') +
          '. Fie-toi au résultat encadré et à la démarche ci-dessus.</p>' + (r.failures.length ? '<div class="formula small-f"></div>' : '') + '</div></div>';
      } else f = '<p class="status muted">' + icon('info') + '<span>' + src + ' · vérification automatique partielle</span></p>';
      f += '<div class="actions">' + button('regenerate', 'Réécrire', 'retry', 'text') + '</div>';
    }
    foot.innerHTML = f;
    var ff = foot.querySelector('.small-f');
    if (ff && x.report) tex(ff, x.report.failures[0].replace(/=/, '\\neq'), false);
  }
}

function renderNotes(s) {
  var sol = s.solution, notes = (sol && sol.warnings) || [];
  var extra = s.canVerifyServer;
  if (!notes.length && !extra) { removeSection('notes'); return; }
  section('notes', JSON.stringify([notes, extra]), function (el) {
    el.className = 'notes';
    el.innerHTML = notes.map(function (n) { return '<p class="muted small">' + icon('info') + '<span>' + esc(n) + '</span></p>'; }).join('') +
      (extra ? '<div class="actions">' + button('verify-server', 'Faire vérifier par le serveur', 'server', 'text') + '</div>' : '');
  });
}

function set(s) {
  state = s;
  KATEX_READY.then(function () {
    renderStatement(s);
    if (s.phase === 'loading') return renderLoading(s);
    if (s.phase === 'error') return renderError(s);
    removeSection('loading'); removeSection('error');
    renderResult(s.solution);
    renderSteps(s.solution);
    renderGraph(s.solution);
    renderExplain(s);
    renderNotes(s);
    // ordre des sections
    ['statement', 'result', 'steps', 'graph', 'explain', 'notes'].forEach(function (id) { var e = document.getElementById(id); if (e) doc.appendChild(e); });
  }).catch(function (e) { doc.textContent = 'Affichage indisponible : ' + e.message; });
}

window.__doc = { set: set };
post({ type: 'ready' });
`;

export function buildSolutionHtml(c: WebColors, fontScale: number, dark: boolean): string {
  const base = { katex: ASSET_BASE + LOCAL.katex, cortex: ASSET_BASE + LOCAL.cortex };
  const series = dark ? ['#8DAAFF', '#FDBA74', '#86EFAC', '#F0ABFC'] : ['#1F47C7', '#C2410C', '#15803D', '#A21CAF'];
  const colors = { series, grid: c.line, axis: c.textFaint, label: c.textMuted, point: c.text };
  const size = Math.round(17 * fontScale);
  return `<!DOCTYPE html><html lang="fr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${base.katex}katex.min.css" />
<script>${LOAD_SCRIPT_HELPER}</script>
<style>
${fontFaceCss()}
:root {
  --bg: ${c.bg}; --surface: ${c.surface}; --alt: ${c.surfaceAlt}; --line: ${c.line}; --line-strong: ${c.lineStrong};
  --text: ${c.text}; --muted: ${c.textMuted}; --faint: ${c.textFaint};
  --primary: ${c.primary}; --primary-c: ${c.primaryContainer}; --on-primary-c: ${c.onPrimaryContainer};
  --ok: ${c.success}; --ok-c: ${c.successContainer}; --warn: ${c.warning}; --warn-c: ${c.warningContainer};
  --err: ${c.error}; --err-c: ${c.errorContainer};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); -webkit-tap-highlight-color: transparent; }
body { font: ${size}px/1.55 'CMU Serif', Georgia, serif; -webkit-text-size-adjust: 100%; }
::selection { background: var(--primary-c); color: var(--on-primary-c); }
#doc { padding: 20px 20px 48px; max-width: 720px; margin: 0 auto; }
section { margin: 0 0 32px; }
h2 { font: 700 1.05em/1.3 system-ui, Roboto, sans-serif; letter-spacing: 0; margin: 0 0 14px; color: var(--text); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.muted { color: var(--muted); } .small { font-size: 0.86em; }
.ic { width: 1.1em; height: 1.1em; flex: none; vertical-align: -0.18em; }
.katex { font-size: 1.08em; } .katex-display { margin: 0.2em 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }

.statement { margin-bottom: 24px; }
.statement .formula.big { font-size: 1.22em; }
.statement .kind { margin: 4px 0 0; text-align: center; color: var(--muted); font-style: italic; }

.result .boxed { position: relative; padding: 18px 16px 14px; border: 1.5px solid var(--primary); border-radius: 6px; background: var(--surface);
  box-shadow: 0 0 0 4px var(--bg), 0 0 0 5px var(--line); }
/* le cadre se trace d'un trait d'encre : couche décorative, le résultat reste toujours visible */
.result .boxed::after { content: ''; position: absolute; inset: -1.5px; border: 1.5px solid var(--primary); border-radius: 6px; pointer-events: none; opacity: 0; }
.result .answer { font-size: 1.55em; color: var(--primary); }
.result .approx { font-size: 0.95em; color: var(--muted); }
.status { display: flex; gap: 8px; align-items: flex-start; margin: 14px 2px 0; font: 500 0.82em/1.4 system-ui, Roboto, sans-serif; }
.status.ok { color: var(--ok); } .status.warn { color: var(--warn); } .status.muted { color: var(--muted); }
@media (prefers-reduced-motion: no-preference) {
  .result .boxed { animation: ink 520ms cubic-bezier(0.16, 1, 0.3, 1); }
  .result .boxed::after { animation: frame 640ms cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes ink { from { border-color: var(--line); } }
  @keyframes frame { from { opacity: 1; clip-path: inset(0 100% 0 0); } 70% { opacity: 1; } to { opacity: 0; clip-path: inset(0 0 0 0); } }
}

.rail { list-style: none; margin: 0; padding: 0; position: relative; }
.rail::before { content: ''; position: absolute; left: 13px; top: 14px; bottom: 14px; width: 1.5px; background: var(--line-strong); }
.rail li { position: relative; display: flex; gap: 14px; padding-bottom: 18px; }
.rail li:last-child { padding-bottom: 0; }
.node { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--bg); border: 1.5px solid var(--primary); color: var(--primary);
  font: 600 13px/25px system-ui, Roboto, sans-serif; text-align: center; position: relative; z-index: 1; font-variant-numeric: tabular-nums; }
.step { flex: 1; min-width: 0; padding-top: 1px; }
.step .text { margin: 0 0 4px; }
.step .formula { padding: 2px 0; }

.graph .plot { position: relative; height: ${Math.round(280 * Math.min(fontScale, 1.3))}px; border-radius: 12px; overflow: hidden; background: var(--surface); border: 1px solid var(--line); }
.graph canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.legend { position: absolute; left: 10px; top: 10px; font-size: 0.78em; background: var(--surface); border-radius: 6px; padding: 4px 8px; pointer-events: none; border: 1px solid var(--line); }
.legend div { display: flex; align-items: center; gap: 8px; } .legend i { display: inline-block; width: 18px; height: 3px; border-radius: 2px; }
.tip { position: absolute; left: 10px; bottom: 10px; font-size: 0.82em; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; pointer-events: none; display: none; font-variant-numeric: tabular-nums; }
.zoom { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 6px; }
.round { width: 44px; height: 44px; border-radius: 22px; border: 1px solid var(--line); background: var(--surface); color: var(--text); display: flex; align-items: center; justify-content: center; padding: 0; }
.graph p { margin: 8px 2px 0; }

.explain-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.explain-head h2 { margin: 0; }
.levels { display: flex; gap: 6px; }
.chip { min-height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line-strong); background: transparent; color: var(--muted); font: 500 14px system-ui, Roboto, sans-serif; }
.chip.on { background: var(--primary-c); border-color: var(--primary-c); color: var(--on-primary-c); }
.chip:disabled { opacity: 0.55; }
.explain-text { hyphens: auto; }
.explain-text p { margin: 0 0 0.7em; }
.explain-text p:last-of-type { margin-bottom: 0; }
.explain-text:empty { display: none; }
.caret { display: inline-block; width: 0.5em; height: 1em; vertical-align: -0.12em; margin-left: 2px; background: var(--primary); border-radius: 1px; }
@media (prefers-reduced-motion: no-preference) { .caret { animation: blink 1s steps(1) infinite; } @keyframes blink { 50% { opacity: 0; } } }
.spinner { display: inline-block; width: 14px; height: 14px; margin-right: 10px; vertical-align: -2px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--primary); }
@media (prefers-reduced-motion: no-preference) { .spinner { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } } }

.callout { display: flex; gap: 12px; padding: 14px 16px; border-radius: 12px; font: 400 0.9em/1.45 system-ui, Roboto, sans-serif; }
.callout p { margin: 0; } .callout h2 { margin: 0 0 4px; font-size: 1.05em; }
.callout.info { background: var(--alt); color: var(--text); } .callout.info .ic { color: var(--primary); }
.callout.warn { background: var(--warn-c); color: var(--text); } .callout.warn .ic { color: var(--warn); }
.callout .ic { margin-top: 2px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.btn { min-height: 48px; padding: 0 20px; border-radius: 24px; border: 0; display: inline-flex; align-items: center; gap: 8px; font: 500 14px system-ui, Roboto, sans-serif; }
.btn.filled { background: var(--primary); color: ${dark ? '#0B1640' : '#FFFFFF'}; }
.btn.tonal { background: var(--primary-c); color: var(--on-primary-c); }
.btn.outlined { background: transparent; color: var(--primary); border: 1px solid var(--line-strong); }
.btn.text { background: transparent; color: var(--primary); padding: 0 12px; margin-left: -12px; }
.btn:active { filter: brightness(0.92); }
.notes p { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 6px; font-family: system-ui, Roboto, sans-serif; }

.loading .skeleton { background: var(--alt); border-radius: 6px; margin-bottom: 12px; }
.loading .frame { height: 84px; } .loading .line { height: 16px; } .loading .short { width: 60%; }
@media (prefers-reduced-motion: no-preference) { .loading .skeleton { animation: pulse 1.4s ease-in-out infinite; } @keyframes pulse { 50% { opacity: 0.55; } } }
.error .callout { margin-bottom: 4px; }
</style></head><body><main id="doc"></main>
<script>
var BASE = ${JSON.stringify(base)};
var COLORS = ${JSON.stringify(colors)};
var SCALE = ${fontScale};
${PAGE_JS}
</script></body></html>`;
}
