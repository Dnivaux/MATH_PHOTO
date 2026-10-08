#!/usr/bin/env node
/**
 * Télécharge dans l'APK (android/app/src/main/assets/engine/) tout ce que les
 * WebView utilisent, pour un fonctionnement 100 % hors ligne :
 *   - modèle OCR Texo (ONNX, ~80 Mo)  - transformers.js + onnxruntime-web (WASM)
 *   - CortexJS                         - Pyodide + SymPy
 *   - KaTeX (rendu)                    - MathLive (éditeur de la calculatrice)
 *
 * Usage : npm run engine-assets            (ne retélécharge pas ce qui existe)
 *         npm run engine-assets -- --force
 * Les versions doivent rester alignées avec src/engine/assets.ts.
 */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'android/app/src/main/assets/engine');
const FORCE = process.argv.includes('--force');

const V = { cortex: '0.30.2', pyodide: '0.27.7', transformers: '3.7.5', katex: '0.16.11', mathlive: '0.107.1' };
const JSD = 'https://cdn.jsdelivr.net';
const MODEL_SOURCES = [
  'https://huggingface.co/alephpi/FormulaNet/resolve/main/',
  'https://raw.githubusercontent.com/alephpi/Texo-web/refs/heads/master/models/model/',
];
const MODEL_FILES = [
  'config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx',
];
const KATEX_FONTS = ['AMS-Regular', 'Caligraphic-Bold', 'Caligraphic-Regular', 'Fraktur-Bold', 'Fraktur-Regular',
  'Main-Bold', 'Main-BoldItalic', 'Main-Italic', 'Main-Regular', 'Math-BoldItalic', 'Math-Italic', 'SansSerif-Bold',
  'SansSerif-Italic', 'SansSerif-Regular', 'Script-Regular', 'Size1-Regular', 'Size2-Regular', 'Size3-Regular',
  'Size4-Regular', 'Typewriter-Regular'].map(f => `KaTeX_${f}.woff2`);

let total = 0;

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function download(urls, dest) {
  const path = join(OUT, dest);
  if (!FORCE && (await exists(path))) {
    total += (await stat(path)).size;
    return;
  }
  let lastErr;
  for (const url of [].concat(urls)) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, buf);
        total += buf.length;
        console.log(`  ${dest}  ${(buf.length / 1e6).toFixed(1)} Mo`);
        return;
      } catch (e) {
        lastErr = new Error(`${url} : ${e.message}`);
      }
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`Fichiers embarqués -> ${OUT}`);

  console.log('CortexJS');
  await download(`${JSD}/npm/@cortex-js/compute-engine@${V.cortex}/dist/compute-engine.min.umd.js`, 'cortex/compute-engine.min.umd.js');

  console.log('transformers.js + onnxruntime-web');
  for (const f of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    await download(`${JSD}/npm/@huggingface/transformers@${V.transformers}/dist/${f}`, `transformers/${f}`);
  }

  console.log('Modèle OCR Texo');
  for (const f of MODEL_FILES) {
    await download(MODEL_SOURCES.map(s => s + f), `models/texo/${f}`);
  }

  console.log('Pyodide + SymPy');
  const py = `${JSD}/pyodide/v${V.pyodide}/full/`;
  for (const f of ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
    await download(py + f, `pyodide/${f}`);
  }
  const lock = JSON.parse(await readFile(join(OUT, 'pyodide/pyodide-lock.json'), 'utf8'));
  const wanted = new Set();
  const visit = name => {
    const pkg = lock.packages[name];
    if (!pkg || wanted.has(name)) return;
    wanted.add(name);
    (pkg.depends || []).forEach(visit);
  };
  visit('sympy');
  for (const name of wanted) await download(py + lock.packages[name].file_name, `pyodide/${lock.packages[name].file_name}`);

  console.log('KaTeX');
  const kx = `${JSD}/npm/katex@${V.katex}/dist/`;
  for (const f of ['katex.min.css', 'katex.min.js', 'contrib/auto-render.min.js']) await download(kx + f, `katex/${f}`);
  for (const f of KATEX_FONTS) await download(kx + 'fonts/' + f, `katex/fonts/${f}`);

  console.log('MathLive');
  const ml = `${JSD}/npm/mathlive@${V.mathlive}/`;
  await download(ml + 'mathlive.min.js', 'mathlive/mathlive.min.js');
  await download(ml + 'mathlive-fonts.css', 'mathlive/mathlive-fonts.css');
  for (const f of KATEX_FONTS) await download(ml + 'fonts/' + f, `mathlive/fonts/${f}`);

  console.log(`OK : ${(total / 1e6).toFixed(0)} Mo embarqués`);
}

main().catch(e => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
