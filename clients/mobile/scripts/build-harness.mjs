#!/usr/bin/env node
/**
 * Banc d'essai du moteur embarqué dans un navigateur : même code que la WebView de l'app (mathSource,
 * ocrSource, FETCH_SHIM), servi en HTTP avec les fichiers de android/app/src/main/assets/engine/.
 *
 *   node scripts/build-harness.mjs        puis servir le dossier de l'app (port 8765) et ouvrir
 *   http://localhost:8765/scripts/engine-harness/index.html
 *
 * La page compare la sortie OCR JavaScript à la référence Python (samples/samples.json, produite par
 * make_samples.py) et lance quelques analyses et vérifications d'explication.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts/engine-harness');

async function raw(file, name) {
  const src = await readFile(join(ROOT, file), 'utf8');
  const start = src.indexOf(`export const ${name} = String.raw\``);
  if (start < 0) throw new Error(`${name} introuvable dans ${file}`);
  const from = src.indexOf('`', start) + 1;
  const to = src.indexOf('\n`;', from);
  return src.slice(from, to);
}

const bundle = `// généré par scripts/build-harness.mjs : ne pas modifier
${await raw('src/engine/assets.ts', 'FETCH_SHIM')}
${await raw('src/engine/mathSource.ts', 'MATH_SOURCE')}
${await raw('src/engine/ocrSource.ts', 'OCR_SOURCE')}
`;
await writeFile(join(OUT, 'engine-bundle.js'), bundle);
console.log('engine-bundle.js écrit');
