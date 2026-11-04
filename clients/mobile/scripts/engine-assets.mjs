#!/usr/bin/env node
/**
 * Copie dans l'APK (android/app/src/main/assets/engine/) tout ce que les WebView utilisent, pour un
 * fonctionnement 100 % hors ligne. Aucun téléchargement : les fichiers viennent de node_modules (versions
 * figées par package-lock.json) et de l'export ONNX des lecteurs OCR.
 *
 *   - CortexJS (calcul exact)            - onnxruntime-web 1.18 (WASM, sans module ES)
 *   - KaTeX (rendu des formules)         - MathLive (éditeur de la calculatrice)
 *   - CMU Serif (texte des explications) - OCR : pix2text-mfr v1 et 1.5 en INT8 (~65 Mo)
 *
 * Lecteurs OCR : produits par `.venv-ocr/bin/python clients/mobile/scripts/p2t_mfr/export.py` (depuis la racine
 * du dépôt). Le dossier onnx/ (readers.json + un dossier par lecteur) est cherché dans OCR_DIR, puis dans
 * scripts/p2t_mfr/onnx.
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

const OCR_CANDIDATES = [process.env.OCR_DIR, join(ROOT, 'scripts/p2t_mfr/onnx')].filter(Boolean);

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
  for (const old of ['pyodide', 'transformers', 'models/texo', 'models/pix2tex', 'models/ocr']) await rm(join(OUT, old), { recursive: true, force: true });

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

  console.log('Lecteurs OCR');
  const dir = OCR_CANDIDATES.map(p => resolve(p)).find(p => existsSync(join(p, 'readers.json')));
  if (!dir) {
    throw new Error(
      `export ONNX des lecteurs OCR introuvable (cherché : ${OCR_CANDIDATES.join(', ')}).\n` +
        'Lancer `.venv-ocr/bin/python clients/mobile/scripts/p2t_mfr/export.py` à la racine du dépôt, ou définir OCR_DIR.',
    );
  }
  const { readers } = JSON.parse(await readFile(join(dir, 'readers.json'), 'utf8'));
  for (const name of readers) {
    const cfg = JSON.parse(await readFile(join(dir, name, 'config.json'), 'utf8'));
    for (const f of [cfg.encoder, cfg.decoder]) {
      const expected = cfg.files?.[f]?.sha256;
      if (expected && (await sha256(join(dir, name, f))) !== expected) {
        throw new Error(`${name}/${f} : empreinte SHA-256 différente de config.json`);
      }
      await put(join(dir, name, f), `models/ocr/${name}/${f}`);
    }
    for (const f of ['vocab.json', 'config.json']) await put(join(dir, name, f), `models/ocr/${name}/${f}`);
  }
  await put(join(dir, 'readers.json'), 'models/ocr/readers.json');

  console.log(`OK : ${(total / 1e6).toFixed(0)} Mo embarqués`);
}

main().catch(e => {
  console.error('ÉCHEC :', e.message);
  process.exit(1);
});
