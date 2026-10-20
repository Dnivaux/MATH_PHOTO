#!/usr/bin/env node
/**
 * Copie dans l'APK (android/app/src/main/assets/engine/) tout ce que les WebView utilisent, pour un
 * fonctionnement 100 % hors ligne. Aucun téléchargement : les fichiers viennent de node_modules (versions
 * figées par package-lock.json) et de l'export ONNX de pix2tex.
 *
 *   - CortexJS (calcul exact)            - onnxruntime-web 1.18 (WASM, sans module ES)
 *   - KaTeX (rendu des formules)         - MathLive (éditeur de la calculatrice)
 *   - CMU Serif (texte des explications) - modèle OCR pix2tex INT8 (~38 Mo)
 *
 * Modèle OCR : produit par `uv run export_onnx.py` (dossier scripts/pix2tex/). Le dossier onnx/ est
 * cherché dans PIX2TEX_DIR, puis aux emplacements habituels.
 *
 * Usage : npm run engine-assets
 */
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'android/app/src/main/assets/engine');
const NM = join(ROOT, 'node_modules');

const PIX2TEX_CANDIDATES = [
  process.env.PIX2TEX_DIR,
  join(ROOT, 'scripts/pix2tex/onnx'),
  join(ROOT, '../../models/pix2tex/onnx'), // copie de travail projet_MLops
].filter(Boolean);

let total = 0;

async function put(src, dest) {
  const to = join(OUT, dest);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(src, to);
  const size = (await stat(to)).size;
  total += size;
  if (size > 1e6) console.log(`  ${dest}  ${(size / 1e6).toFixed(1)} Mo`);
}

async function sha256(p) {
  return createHash('sha256').update(await readFile(p)).digest('hex');
}

async function main() {
  console.log(`Fichiers embarqués -> ${OUT}`);
  // anciens moteurs (Pyodide, transformers.js, Texo) : retirés de l'APK
  for (const old of ['pyodide', 'transformers', 'models/texo']) await rm(join(OUT, old), { recursive: true, force: true });

  console.log('CortexJS');
  await put(join(NM, '@cortex-js/compute-engine/dist/compute-engine.min.umd.js'), 'cortex/compute-engine.min.umd.js');

  console.log('onnxruntime-web');
  for (const f of ['ort.wasm.min.js', 'ort-wasm-simd.wasm']) await put(join(NM, 'onnxruntime-web/dist', f), `ort/${f}`);

  console.log('KaTeX');
  for (const f of ['katex.min.css', 'katex.min.js', 'contrib/auto-render.min.js']) await put(join(NM, 'katex/dist', f), `katex/${f}`);
  for (const f of await readdir(join(NM, 'katex/dist/fonts'))) {
    if (f.endsWith('.woff2')) await put(join(NM, 'katex/dist/fonts', f), `katex/fonts/${f}`);
  }

  console.log('MathLive');
  await put(join(NM, 'mathlive/mathlive.min.js'), 'mathlive/mathlive.min.js');
  for (const f of await readdir(join(NM, 'mathlive/fonts'))) {
    if (f.endsWith('.woff2')) await put(join(NM, 'mathlive/fonts', f), `mathlive/fonts/${f}`);
  }

  console.log('CMU Serif');
  for (const f of ['cmu-serif-500-roman.woff2', 'cmu-serif-500-italic.woff2', 'cmu-serif-700-roman.woff2']) {
    await put(join(NM, 'computer-modern/fonts', f), `fonts/${f}`);
  }
  await put(join(NM, 'computer-modern/OFL.txt'), 'fonts/OFL.txt');

  console.log('Modèle OCR pix2tex');
  const dir = PIX2TEX_CANDIDATES.map(p => resolve(p)).find(p => existsSync(join(p, 'config.json')));
  if (!dir) {
    throw new Error(
      `export ONNX de pix2tex introuvable (cherché : ${PIX2TEX_CANDIDATES.join(', ')}).\n` +
        'Lancer `uv run export_onnx.py` dans scripts/pix2tex, ou définir PIX2TEX_DIR.',
    );
  }
  const cfg = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
  for (const f of [cfg.encoder, cfg.decoder, cfg.resizer]) {
    const expected = cfg.files?.[f]?.sha256;
    if (expected && (await sha256(join(dir, f))) !== expected) throw new Error(`${f} : empreinte SHA-256 différente de config.json`);
    await put(join(dir, f), `models/pix2tex/${f}`);
  }
  await put(join(dir, 'vocab.json'), 'models/pix2tex/vocab.json');
  await put(join(dir, 'config.json'), 'models/pix2tex/config.json');

  console.log(`OK : ${(total / 1e6).toFixed(0)} Mo embarqués`);
}

main().catch(e => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
