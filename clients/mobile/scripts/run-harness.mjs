#!/usr/bin/env node
/**
 * Lance le banc navigateur (scripts/engine-harness/index.html) dans Chromium sans écran et affiche le résultat :
 * lecture OCR JavaScript identique ou non à la référence Python, pour chaque image et chaque lecteur.
 *
 *   npm run engine-assets && node scripts/build-harness.mjs && node scripts/run-harness.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const BROWSER = process.env.CHROMIUM || 'chromium';

let browser;
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__results') {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.end('ok');
    report(JSON.parse(body));
    return;
  }
  const path = normalize(join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!path.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end();
  }
});

function report(r) {
  if (r.error) console.log('ERREUR', r.error);
  for (const m of r.math) console.log('  ' + m);
  let same = 0;
  for (const o of r.ocr) {
    same += o.same;
    console.log(`${o.same ? '=' : '≠'} ${o.file.padEnd(13)} ${o.reader.padEnd(12)} ${String(o.ms).padStart(6)} ms  conf ${o.conf} (py ${o.pyConf})  ${o.same ? o.js : `JS ${o.js}  |  PY ${o.python}`}`);
  }
  console.log(`OCR : ${same}/${r.ocr.length} lectures identiques à Python`);
  browser?.kill();
  server.close();
  // une lecture peut différer d'écriture (pixels du prétraitement canvas) : on ne lève une erreur que si le banc échoue
  process.exitCode = r.error ? 1 : 0;
}

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/scripts/engine-harness/index.html?report=1`;
  browser = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(ROOT, 'scripts/engine-harness/.build/chromium')}`, url], { stdio: 'ignore' });
  setTimeout(() => { console.log('ÉCHEC : pas de résultat après 10 min'); browser.kill(); server.close(); process.exitCode = 1; }, 600000).unref();
});
