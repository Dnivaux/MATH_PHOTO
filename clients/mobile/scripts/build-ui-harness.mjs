#!/usr/bin/env node
/**
 * Pages WebView de l'app (solution, historique) rendues hors du téléphone, pour les vérifier dans un
 * navigateur : les générateurs TypeScript sont transpilés tels quels, les fichiers embarqués sont servis
 * en HTTP. Écrit scripts/engine-harness/ui-*.html (servir le dossier de l'app, port 8765).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, 'scripts/engine-harness/.build');
const OUT = join(ROOT, 'scripts/engine-harness');
const ASSETS = '../../android/app/src/main/assets/engine/';

const files = {
  'engine/assets': 'src/engine/assets.ts',
  'components/solution/solutionHtml': 'src/components/solution/solutionHtml.ts',
  'components/history/historyHtml': 'src/components/history/historyHtml.ts',
  'theme/tokens': 'src/theme/tokens.ts',
};
for (const [mod, file] of Object.entries(files)) {
  let src = await readFile(join(ROOT, file), 'utf8');
  src = src.replace("'file:///android_asset/engine/'", JSON.stringify(ASSETS));
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  await mkdir(join(TMP, dirname(mod)), { recursive: true });
  await writeFile(join(TMP, `${mod}.js`), out.replace(/require\("\.\.\/\.\.\/theme"\)/g, 'require("../../theme/tokens")'));
}
const require = createRequire(import.meta.url);
const { buildSolutionHtml } = require(join(TMP, 'components/solution/solutionHtml.js'));
const { buildHistoryHtml } = require(join(TMP, 'components/history/historyHtml.js'));
const { light, dark } = require(join(TMP, 'theme/tokens.js'));

const web = c => ({ ...c });
const LEVELS = [
  { id: 'college', label: 'Collège' },
  { id: 'lycee', label: 'Lycée' },
  { id: 'superieur', label: 'Supérieur' },
];

const linear = {
  phase: 'done',
  latex: '3x-7=11',
  kindLabel: 'Équation du premier degré',
  levels: LEVELS,
  canVerifyServer: true,
  solution: {
    result: { latex: 'x \\in \\left\\{6\\right\\}', numeric: null },
    verified: true,
    route: 'local',
    steps: [
      { text_fr: 'On regroupe les termes en x à gauche et les constantes à droite.', latex: '3x = 18' },
      { text_fr: 'On divise les deux membres par 3.', latex: 'x = 6' },
      { text_fr: "L'équation admet une unique solution : $x = 6$.", latex: null },
    ],
    plot: { var: 'x', curves: [{ label: 'membre de gauche', latex: '3x-7' }, { label: 'membre de droite', latex: '11' }], points: [{ label: 'x = 6', x: 6, y: 11 }] },
    warnings: [],
  },
  explain: {
    status: 'done',
    via: 'device',
    level: 'lycee',
    text:
      "On commence par isoler les termes en $x$ : en ajoutant 7 aux deux membres, on obtient $3x = 18$.\n\nOn divise ensuite les deux membres par 3, ce qui donne $x = 6$.\n\nL'équation admet donc une unique solution : $x = 6$.",
    report: { ok: 3, fail: 0, unparsed: 0, failures: [], finalStated: true, numbers: 4, hallucinated: [], score: 1, accept: true },
  },
};

const derivative = {
  phase: 'done',
  latex: '\\frac{d}{dx}\\left(x^{2} e^{x}\\right)',
  kindLabel: 'Dérivée',
  levels: LEVELS,
  solution: {
    result: { latex: 'x^{2} e^{x} + 2 x e^{x}', numeric: null },
    verified: false,
    route: 'server',
    steps: [
      { text_fr: 'Dérivée d’un produit $u \\cdot v$ avec $u = x^{2}$ et $v = e^{x}$.', latex: "(uv)' = u'v + uv'" },
      { text_fr: 'On rassemble les termes.', latex: "f'(x) = 2 x e^{x} + x^{2} e^{x}" },
    ],
    plot: { var: 'x', curves: [{ label: 'f(x)', latex: 'x^{2} e^{x}' }, { label: 'f′(x)', latex: 'x^{2} e^{x} + 2 x e^{x}' }], points: [] },
    warnings: ['Le serveur n’a pas pu confirmer ce résultat par une seconde méthode.'],
  },
  explain: { status: 'streaming', via: 'device', level: 'college', text: 'On reconnaît le produit de deux fonctions : $u = x^{2}$ et $v = e^{x}$. La dérivée d’un produit' },
};

const queued = {
  phase: 'error',
  latex: '2x^{2}-3x-5=0',
  levels: LEVELS,
  error: {
    title: 'En attente du réseau',
    message: 'Ce problème a besoin du serveur et tu es hors ligne. Il est enregistré dans l’historique et partira dès que la connexion reviendra.',
    canRetry: true,
    canEdit: false,
    queued: true,
  },
};

const pages = [
  ['ui-linear-light', buildSolutionHtml(web(light), 1, false), linear],
  ['ui-linear-dark', buildSolutionHtml(web(dark), 1, true), linear],
  ['ui-derivative-light', buildSolutionHtml(web(light), 1, false), derivative],
  ['ui-queued-light', buildSolutionHtml(web(light), 1, false), queued],
  ['ui-loading-light', buildSolutionHtml(web(light), 1, false), { phase: 'loading', latex: '\\int x e^{x}\\,dx', progress: 'Envoi au serveur…', levels: LEVELS }],
];
for (const [name, html, state] of pages) {
  const inject = `<script>window.__harnessState = ${JSON.stringify(state)}; var __t = setInterval(function () { if (window.__doc) { clearInterval(__t); window.__doc.set(window.__harnessState); } }, 30);</script>`;
  await writeFile(join(OUT, `${name}.html`), html.replace('</body>', `${inject}</body>`));
}
const hist = buildHistoryHtml(web(light), 1);
const items = [
  { id: 1, at: Date.now() - 60e3, latex: '3x-7=11', status: 'done', result: 'x \\in \\left\\{6\\right\\}', kind: 'Équation du premier degré' },
  { id: 2, at: Date.now() - 3600e3, latex: '2x^{2}-3x-5=0', status: 'pending' },
  { id: 3, at: Date.now() - 86400e3 * 2, latex: '\\frac{2}{3}+\\frac{5}{6}', status: 'done', result: '\\frac{3}{2}', kind: 'Calcul' },
  { id: 4, at: Date.now() - 86400e3 * 3, latex: '\\lim_{x\\to0}\\frac{\\sin x}{x}', status: 'failed' },
];
await writeFile(
  join(OUT, 'ui-history-light.html'),
  hist.replace('</body>', `<script>var __t = setInterval(function () { if (window.__list) { clearInterval(__t); window.__list.set(${JSON.stringify(items)}); } }, 30);</script></body>`),
);
console.log('pages écrites :', pages.map(p => p[0]).join(', '), ', ui-history-light');
