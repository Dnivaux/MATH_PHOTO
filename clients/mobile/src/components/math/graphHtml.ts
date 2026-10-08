/**
 * Graphe interactif (canvas) : les courbes sont des fonctions JavaScript
 * générées par SymPy, recalculées à chaque zoom / déplacement.
 *   - un doigt : déplacer      - deux doigts : zoomer (pincer)
 *   - toucher : coordonnées    - double toucher ou ⟲ : vue initiale
 *   - boutons + / − ; molette (ordinateur)
 */
import type { PlotData } from '../../engine/MathEngine';

export function buildGraphHtml(plot: PlotData): string {
  const payload = JSON.stringify(plot).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; height: 100%; background: #FFFFFF; overflow: hidden; font-family: -apple-system, Roboto, sans-serif; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  .btns { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .btns button { width: 34px; height: 34px; border-radius: 8px; border: 1px solid #D4D4D8; background: rgba(255,255,255,0.92);
    font-size: 18px; color: #18181B; padding: 0; }
  #legend { position: absolute; left: 8px; top: 8px; font-size: 12px; color: #3F3F46; background: rgba(255,255,255,0.85);
    border-radius: 6px; padding: 4px 6px; pointer-events: none; }
  #legend div { display: flex; align-items: center; gap: 6px; }
  #legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; }
  #tip { position: absolute; left: 8px; bottom: 8px; font-size: 12px; color: #18181B; background: rgba(255,255,255,0.9);
    border-radius: 6px; padding: 3px 6px; pointer-events: none; display: none; font-variant-numeric: tabular-nums; }
</style></head><body>
<canvas id="c"></canvas>
<div id="legend"></div>
<div id="tip"></div>
<div class="btns"><button id="zin">+</button><button id="zout">−</button><button id="reset">⟲</button></div>
<script>
var P = ${payload};
var COLORS = ['#E5484D', '#0090FF', '#30A46C', '#F76B15', '#8E4EC6'];
var c = document.getElementById('c'), ctx = c.getContext('2d');
var dpr = window.devicePixelRatio || 1, W = 0, H = 0;
var fns = [];
P.curves.forEach(function (cv, i) {
  try { fns.push({ f: new Function(P.var, 'return (' + cv.js + ');'), label: cv.label, color: COLORS[i % COLORS.length] }); } catch (e) {}
});
var legend = document.getElementById('legend');
if (fns.length > 1) legend.innerHTML = fns.map(function (f) { return '<div><i style="background:' + f.color + '"></i>' + f.label + '</div>'; }).join('');
else legend.style.display = 'none';

var view = {};
function evalAt(fn, x) { try { var y = fn.f(x); return (typeof y === 'number' && isFinite(y)) ? y : NaN; } catch (e) { return NaN; } }
function initialView() {
  var x0 = -10, x1 = 10;
  if (P.range && isFinite(P.range[0]) && isFinite(P.range[1]) && P.range[1] > P.range[0]) { x0 = P.range[0]; x1 = P.range[1]; }
  // échelle verticale : centiles des valeurs visibles (évite les asymptotes)
  var ys = [];
  for (var i = 0; i <= 400; i++) { var x = x0 + (x1 - x0) * i / 400; fns.forEach(function (fn) { var y = evalAt(fn, x); if (!isNaN(y)) ys.push(y); }); }
  P.points.forEach(function (p) { ys.push(p.y); });
  ys.sort(function (a, b) { return a - b; });
  var y0 = -10, y1 = 10;
  if (ys.length) {
    y0 = ys[Math.floor(ys.length * 0.03)]; y1 = ys[Math.floor(ys.length * 0.97)];
    var pad = Math.max((y1 - y0) * 0.15, 1); y0 -= pad; y1 += pad;
    if (y0 > 0) y0 = Math.min(y0, -pad * 0.5); if (y1 < 0) y1 = Math.max(y1, pad * 0.5);
  }
  return { x0: x0, x1: x1, y0: y0, y1: y1 };
}
function resize() {
  W = c.clientWidth; H = c.clientHeight;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
function sx(x) { return (x - view.x0) / (view.x1 - view.x0) * W; }
function sy(y) { return H - (y - view.y0) / (view.y1 - view.y0) * H; }
function wx(px) { return view.x0 + px / W * (view.x1 - view.x0); }
function wy(py) { return view.y0 + (H - py) / H * (view.y1 - view.y0); }
function niceStep(range, target) {
  var raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function fmt(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  var d = Math.max(0, -Math.floor(Math.log10(step)) + (step / Math.pow(10, Math.floor(Math.log10(step))) === 5 ? 0 : 0));
  return Math.abs(v) >= 1e5 || Math.abs(v) < 1e-4 ? v.toExponential(1) : v.toFixed(Math.min(d, 6));
}
var trace = null;
function draw() {
  ctx.clearRect(0, 0, W, H);
  var sxStep = niceStep(view.x1 - view.x0, W / 70), syStep = niceStep(view.y1 - view.y0, H / 55);
  ctx.lineWidth = 1; ctx.strokeStyle = '#EEF0F2'; ctx.beginPath();
  for (var gx = Math.ceil(view.x0 / sxStep) * sxStep; gx <= view.x1; gx += sxStep) { ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), H); }
  for (var gy = Math.ceil(view.y0 / syStep) * syStep; gy <= view.y1; gy += syStep) { ctx.moveTo(0, sy(gy)); ctx.lineTo(W, sy(gy)); }
  ctx.stroke();
  // axes
  var ax = Math.min(Math.max(sy(0), 0), H), ay = Math.min(Math.max(sx(0), 0), W);
  ctx.strokeStyle = '#71717A'; ctx.lineWidth = 1.2; ctx.beginPath();
  ctx.moveTo(0, ax); ctx.lineTo(W, ax); ctx.moveTo(ay, 0); ctx.lineTo(ay, H); ctx.stroke();
  ctx.fillStyle = '#52525B'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (gx = Math.ceil(view.x0 / sxStep) * sxStep; gx <= view.x1; gx += sxStep) {
    if (Math.abs(gx) < sxStep / 2) continue;
    ctx.fillText(fmt(gx, sxStep), sx(gx), Math.min(ax + 3, H - 14));
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (gy = Math.ceil(view.y0 / syStep) * syStep; gy <= view.y1; gy += syStep) {
    if (Math.abs(gy) < syStep / 2) continue;
    ctx.fillText(fmt(gy, syStep), Math.max(ay - 4, 30), sy(gy));
  }
  // courbes : un point par pixel, coupure aux discontinuités
  fns.forEach(function (fn) {
    ctx.strokeStyle = fn.color; ctx.lineWidth = 2.2; ctx.beginPath();
    var started = false, prev = NaN;
    for (var px = 0; px <= W; px += 1) {
      var y = evalAt(fn, wx(px)), py = sy(y);
      if (isNaN(y) || Math.abs(py) > 1e5 || (!isNaN(prev) && Math.abs(py - prev) > H * 2)) { started = false; prev = NaN; continue; }
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      prev = py;
    }
    ctx.stroke();
  });
  // points remarquables (solutions…)
  P.points.forEach(function (p) {
    ctx.fillStyle = '#18181B'; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 4.5, 0, 2 * Math.PI); ctx.fill();
  });
  if (trace && fns.length) {
    var y = evalAt(fns[0], trace);
    if (!isNaN(y)) {
      ctx.strokeStyle = 'rgba(24,24,27,0.35)'; ctx.setLineDash([4, 4]); ctx.beginPath();
      ctx.moveTo(sx(trace), 0); ctx.lineTo(sx(trace), H); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = fns[0].color; ctx.beginPath(); ctx.arc(sx(trace), sy(y), 5, 0, 2 * Math.PI); ctx.fill();
      tip.style.display = 'block';
      tip.textContent = P.var + ' = ' + (+trace.toPrecision(5)) + '    y = ' + (+y.toPrecision(5));
    } else tip.style.display = 'none';
  } else tip.style.display = 'none';
}
var tip = document.getElementById('tip');
function zoom(f, cx, cy) {
  var X = wx(cx), Y = wy(cy);
  view = { x0: X - (X - view.x0) * f, x1: X + (view.x1 - X) * f, y0: Y - (Y - view.y0) * f, y1: Y + (view.y1 - Y) * f };
  draw();
}
// gestes
var ptrs = {}, last = null, moved = false, lastTap = 0;
c.addEventListener('pointerdown', function (e) {
  c.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.offsetX, y: e.offsetY }; moved = false; last = null;
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage('touch-start');
});
c.addEventListener('pointermove', function (e) {
  if (!ptrs[e.pointerId]) return;
  var ids = Object.keys(ptrs);
  var prevP = ptrs[e.pointerId]; ptrs[e.pointerId] = { x: e.offsetX, y: e.offsetY };
  if (ids.length === 1) {
    var dx = e.offsetX - prevP.x, dy = e.offsetY - prevP.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
    var kx = (view.x1 - view.x0) / W, ky = (view.y1 - view.y0) / H;
    view.x0 -= dx * kx; view.x1 -= dx * kx; view.y0 += dy * ky; view.y1 += dy * ky;
    draw();
  } else if (ids.length >= 2) {
    var a = ptrs[ids[0]], b = ptrs[ids[1]];
    var d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (last) { if (d > 0) zoom(last.d / d, mx, my); }
    last = { d: d }; moved = true;
  }
});
function up(e) {
  var wasSingle = Object.keys(ptrs).length === 1;
  delete ptrs[e.pointerId];
  if (Object.keys(ptrs).length < 2) last = null;
  if (wasSingle && !moved) {
    var now = Date.now();
    if (now - lastTap < 300) { view = initialView(); trace = null; draw(); }
    else { trace = wx(e.offsetX); draw(); }
    lastTap = now;
  }
  if (!Object.keys(ptrs).length) window.ReactNativeWebView && window.ReactNativeWebView.postMessage('touch-end');
}
c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
c.addEventListener('wheel', function (e) { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY); }, { passive: false });
document.getElementById('zin').onclick = function () { zoom(1 / 1.5, W / 2, H / 2); };
document.getElementById('zout').onclick = function () { zoom(1.5, W / 2, H / 2); };
document.getElementById('reset').onclick = function () { view = initialView(); trace = null; draw(); };
view = initialView();
window.addEventListener('resize', resize);
resize();
window.__graph = { view: function () { return view; }, zoom: zoom };
</script></body></html>`;
}
