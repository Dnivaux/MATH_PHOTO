/**
 * Nettoyage du LaTeX (sortie OCR ou saisie) avant le parsing CortexJS.
 *
 * CortexJS ne reconnaît pas la notation \frac{d}{dx} comme une dérivée :
 * on la détecte ici et on la sort du LaTeX à parser.
 */

export interface PreprocessedLatex {
  /** LaTeX nettoyé, tel qu'affiché à l'utilisateur */
  cleaned: string;
  /** LaTeX à envoyer au parseur (corps de la dérivée le cas échéant) */
  toParse: string;
  /** Présent si l'expression est de la forme d/dx (...) */
  derivative?: { variable: string; order: number };
}

const D = String.raw`(?:\\mathrm\{d\}|\\operatorname\{d\}|d)`;
// \frac{d}{dx} ou \frac{d^2}{dx^2}
const DERIVATIVE_PREFIX = new RegExp(
  String.raw`^\\frac\{\s*${D}\s*(?:\^\{?(\d)\}?)?\s*\}\{\s*${D}\s*([a-zA-Z])\s*(?:\^\{?(\d)\}?)?\s*\}\s*`,
);

export function cleanLatex(raw: string): string {
  let s = (raw || '').trim();
  // Délimiteurs mathématiques que l'OCR ajoute parfois
  s = s.replace(/^\$\$?|\$\$?$/g, '');
  s = s.replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '');
  s = s.replace(/\\(displaystyle|textstyle|scriptstyle)\b/g, '');
  // Espacements et ponctuation finale sans valeur mathématique
  s = s.replace(/\\[,;:!]|\\quad|\\qquad|~/g, ' ');
  s = s.replace(/[.,;]\s*$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function preprocessLatex(raw: string): PreprocessedLatex {
  const cleaned = cleanLatex(raw);
  const m = cleaned.match(DERIVATIVE_PREFIX);
  if (m) {
    const order = Number(m[1] || m[3] || 1);
    let body = cleaned.slice(m[0].length).trim();
    // \left( ... \right) ou ( ... ) englobant tout le corps
    const wrapped = body.match(/^\\left\((.*)\\right\)$/s) || body.match(/^\((.*)\)$/s);
    if (wrapped && balanced(wrapped[1])) body = wrapped[1];
    if (body.length > 0) {
      return { cleaned, toParse: body, derivative: { variable: m[2], order } };
    }
  }
  return { cleaned, toParse: cleaned };
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Contenu d'un groupe {…} commençant à l'indice i (accolade ouvrante) */
function readGroup(s: string, i: number): { content: string; end: number } | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '{') depth++;
    if (s[j] === '}') {
      depth--;
      if (depth === 0) return { content: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** Remplace \cmd{contenu} par contenu (mise en forme sans valeur mathématique) */
function unwrap(s: string, cmd: string): string {
  let out = s;
  for (let guard = 0; guard < 50; guard++) {
    const idx = out.indexOf(cmd + '{');
    if (idx < 0) break;
    const g = readGroup(out, idx + cmd.length);
    if (!g) break;
    out = out.slice(0, idx) + '{' + g.content + '}' + out.slice(g.end);
  }
  return out;
}

const OPERATORS = ['lim', 'sin', 'cos', 'tan', 'ln', 'log', 'exp', 'max', 'min', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'gcd', 'det'];

/**
 * Normalise la sortie brute de l'OCR (jetons séparés par des espaces, mise en
 * forme \boldsymbol / \boxed, \operatorname*{lim}…) en LaTeX exploitable.
 */
export function normalizeOcrLatex(raw: string): string {
  let s = (raw || '').replace(/~|\\[,;:!](?![a-zA-Z])|\\q?quad/g, ' ');
  // Recolle les jetons ; garde une espace entre une commande et une lettre (\sin x)
  const tokens = s.split(/\s+/).filter(Boolean);
  s = '';
  for (const t of tokens) {
    if (/\\[a-zA-Z]+\*?$/.test(s) && /^[a-zA-Z]/.test(t)) s += ' ';
    s += t;
  }
  for (const cmd of ['\\boldsymbol', '\\mathbf', '\\bm', '\\mathit', '\\boxed', '\\mathrm', '\\textbf', '\\pmb']) {
    s = unwrap(s, cmd);
  }
  s = s.replace(/\\operatorname\*?\{([a-z]+)\}/g, (m, name) => (OPERATORS.includes(name) ? `\\${name}` : m));
  s = s.replace(/\\(rarr|rightarrow|longrightarrow|to)(?![a-zA-Z])/g, '\\to ');
  // tableau d'une seule ligne : on retire l'environnement
  const arr = s.match(/^\\begin\{(array|aligned|gathered)\}(\{[^}]*\})?(.*)\\end\{\1\}$/);
  if (arr && !arr[3].includes('\\\\')) s = arr[3];
  s = s.replace(/\\(displaystyle|textstyle)/g, '');
  // accolades inutiles : autour de \frac{d}{dx} et autour de toute l'expression
  s = s.replace(/\{(\\frac\{d\}\{d[a-zA-Z]\})\}/g, '$1');
  for (let guard = 0; guard < 5 && s.startsWith('{'); guard++) {
    const g = readGroup(s, 0);
    if (!g || g.end !== s.length) break;
    s = g.content;
  }
  return cleanLatex(s);
}
