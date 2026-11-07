#!/usr/bin/env node
/**
 * Vitesse des lecteurs OCR (pix2text-mfr v1 et 1.5) en INT8, FP16 et FP32, avec le code de la WebView de l'app :
 * la page scripts/engine-harness/bench.html est ouverte dans Chrome sur le téléphone (adb reverse), ou dans
 * Chromium sur le PC (--local). Les fichiers ONNX viennent de scripts/p2t_mfr/onnx (export.py) ; config.json est
 * réécrit à la volée pour pointer la variante demandée.
 *
 *   node scripts/build-harness.mjs && node scripts/device-ocr-bench.mjs --out ocr-s24.json [--variants int8,fp32] [--reps 3] [--local]
 *
 * Puis : .venv/bin/python -m eval.device_kernels ocr --file clients/mobile/ocr-s24.json --device "S24 Ultra"
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ONNX = join(ROOT, 'scripts/p2t_mfr/onnx');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const PORT = 8766;

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const LOCAL = process.argv.includes('--local');
const VARIANTS = arg('variants', 'int8,fp32').split(',');
const REPS = arg('reps', '3');
const OUT = arg('out', 'ocr-device-bench.json');

let pending = null;   // résolu par le POST /__results de la page

async function file(path) {
  if (path.startsWith('/ocr/')) {   // /ocr/<variante>/<lecteur>/<fichier>
    const [, , variant, ...rest] = path.split('/');
    const p = join(ONNX, ...rest);
    if (!p.startsWith(ONNX)) throw new Error('hors du dossier');
    if (rest.at(-1) === 'config.json') {
      const cfg = JSON.parse(await readFile(p, 'utf8'));
      Object.assign(cfg, cfg.variants[variant]);
      return Buffer.from(JSON.stringify(cfg));
    }
    return readFile(p);
  }
  const p = normalize(join(ROOT, path));
  if (!p.startsWith(ROOT)) throw new Error('hors du dossier');
  return readFile(p);
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__results') {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.end('ok');
    pending?.(JSON.parse(body));
    return;
  }
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    const data = await file(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end();
  }
});

function open(url) {
  if (LOCAL) {
    const b = spawn(process.env.CHROMIUM || 'chromium', ['--headless=new', '--disable-gpu', '--no-sandbox',
      `--user-data-dir=${join(ROOT, 'scripts/engine-harness/.build/chromium-bench')}`, url], { stdio: 'ignore' });
    return () => b.kill();
  }
  // adb shell recolle les arguments en une ligne de shell : l'URL (avec &) doit être entre guillemets
  execFileSync('adb', ['shell', `am start -a android.intent.action.VIEW -d '${url}' -p com.android.chrome`]);
  return () => {};
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

server.listen(PORT, '127.0.0.1', async () => {
  let device = 'PC (Chromium)';
  if (!LOCAL) {
    execFileSync('adb', ['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    device = execFileSync('adb', ['shell', 'getprop', 'ro.product.model']).toString().trim();
  }
  const results = { device, variants: [] };
  for (const v of VARIANTS) {
    const done = new Promise((resolve) => { pending = resolve; });
    const close = open(`http://localhost:${PORT}/scripts/engine-harness/bench.html?variant=${v}&reps=${REPS}`);
    const r = await done;
    close();
    if (r.error) { console.log(`${v} : ERREUR ${r.error}`); continue; }
    results.variants.push(r);
    const warm = r.runs.filter((x) => x.rep > 0 || r.reps === 1);
    for (const reader of [...new Set(r.runs.map((x) => x.reader))]) {
      const ms = warm.filter((x) => x.reader === reader).map((x) => x.ms);
      const same = r.runs.filter((x) => x.reader === reader && x.raw === x.python).length;
      console.log(`${v.padEnd(5)} ${reader.padEnd(12)} médiane ${String(median(ms)).padStart(6)} ms   chargement ${r.loadMs} ms   lectures = Python INT8 : ${same}/${r.runs.filter((x) => x.reader === reader).length}`);
    }
  }
  await writeFile(OUT, JSON.stringify(results, null, 1));
  console.log(`résultats : ${OUT}`);
  server.close();
});
