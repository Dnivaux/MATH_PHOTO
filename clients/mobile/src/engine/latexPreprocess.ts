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
    if (wrapped && balanced(wrapped[1])) {
      body = wrapped[1];
    }
    if (body.length > 0) {
      return { cleaned, toParse: body, derivative: { variable: m[2], order } };
    }
  }
  return { cleaned, toParse: cleaned };
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === '(') {
      depth++;
    }
    if (c === ')') {
      depth--;
    }
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0;
}

/** Contenu d'un groupe {…} commençant à l'indice i (accolade ouvrante) */
function readGroup(s: string, i: number): { content: string; end: number } | null {
  if (s[i] !== '{') {
    return null;
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '{') {
      depth++;
    }
    if (s[j] === '}') {
      depth--;
      if (depth === 0) {
        return { content: s.slice(i + 1, j), end: j + 1 };
      }
    }
  }
  return null;
}

/** Remplace \cmd{contenu} par contenu (mise en forme sans valeur mathématique) */
function unwrap(s: string, cmd: string): string {
  let out = s;
  for (let guard = 0; guard < 50; guard++) {
    const idx = out.indexOf(cmd + '{');
    if (idx < 0) {
      break;
    }
    const g = readGroup(out, idx + cmd.length);
    if (!g) {
      break;
    }
    out = out.slice(0, idx) + '{' + g.content + '}' + out.slice(g.end);
  }
  return out;
}

const OPERATORS = [
  'lim',
  'sin',
  'cos',
  'tan',
  'ln',
  'log',
  'exp',
  'max',
  'min',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'gcd',
  'det',
];

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
    if (/\\[a-zA-Z]+\*?$/.test(s) && /^[a-zA-Z]/.test(t)) {
      s += ' ';
    }
    s += t;
  }
  // \operatorname*{lim}, \mathrm{sin}, \mathsf{cos} (pix2text-mfr) : la fonction, avant de déballer \mathrm
  s = s.replace(/\\(operatorname\*?|mathrm|mathsf|text|mathit)\{([a-z]+)\}/g, (m, _c, name) =>
    OPERATORS.includes(name) ? `\\${name} ` : m,
  );
  // une seule lettre en gras ou droite : la lettre elle-même (\frac{\mathrm{d}}{\mathrm{d}x} -> \frac{d}{dx})
  s = s.replace(/\\(mathrm|mathsf|mathit|boldsymbol|mathbf|bm)\{([a-zA-Z0-9])\}/g, '$2');
  for (const cmd of ['\\boldsymbol', '\\mathbf', '\\bm', '\\mathit', '\\boxed', '\\mathrm', '\\mathsf', '\\textbf', '\\pmb']) {
    s = unwrap(s, cmd);
  }
  s = undersetLimit(s);
  s = s.replace(/\\(limits|mathstrut|tiny|small|large|Large|LARGE|huge|hline)(?![a-zA-Z])/g, '');
  s = s.replace(/\\[bB]igg?[lrm]?(?![a-zA-Z])/g, ''); // \bigl( -> (
  s = s.replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac');
  s = s.replace(/\\int_\{\}(\^\{\})?/g, '\\int'); // bornes vides
  s = s.replace(/^\s*=\s*/, ''); // une formule ne commence pas par =
  s = s.replace(/(\\[a-zA-Z]+) +([_^])/g, '$1$2'); // \lim _{x\to 0} -> \lim_{x\to 0}
  s = s.replace(/\\(rarr|rightarrow|longrightarrow|to)(?![a-zA-Z])/g, '\\to ');
  // tableau d'une seule ligne : on retire l'environnement
  const arr = s.match(/^\\begin\{(array|aligned|gathered)\}(\{[^}]*\})?(.*)\\end\{\1\}$/);
  if (arr && !arr[3].includes('\\\\')) {
    s = arr[3];
  }
  s = s.replace(/\\(displaystyle|textstyle)/g, '');
  // pix2tex lit parfois le x italique comme \chi, ou en capitale : dans un exercice, c'est x
  // (une commande collée devant garde une espace : \int\chi -> \int x, pas \intx)
  s = s.replace(/(\\[a-zA-Z]+)?\\chi(?![a-zA-Z])/g, (_m, cmd) => (cmd ? `${cmd} ` : '') + 'x');
  if (!/x/.test(s.replace(/\\[a-zA-Z]+/g, ''))) {
    s = s.replace(/(^|[^\\a-zA-Z])X(?![a-zA-Z])/g, '$1x');
  }
  // accolades inutiles : autour de \frac{d}{dx} et autour de toute l'expression
  s = s.replace(/\{(\\frac\{d\}\{d[a-zA-Z]\})\}/g, '$1');
  for (let guard = 0; guard < 5 && s.startsWith('{'); guard++) {
    const g = readGroup(s, 0);
    if (!g || g.end !== s.length) {
      break;
    }
    s = g.content;
  }
  return cleanLatex(s);
}

/** \underset{x\to 0}{\lim} (pix2text-mfr 1.5) -> \lim_{x\to 0} */
function undersetLimit(s: string): string {
  let out = s;
  for (let guard = 0; guard < 10; guard++) {
    const idx = out.indexOf('\\underset{');
    if (idx < 0) {
      break;
    }
    const below = readGroup(out, idx + '\\underset'.length);
    const op = below && readGroup(out, below.end);
    if (!below || !op || !/^\s*\{?\s*\\lim\s*\}?\s*$/.test(op.content)) {
      break;
    }
    const inner = readGroup(below.content, 0);
    const sub = inner && inner.end === below.content.length ? inner.content : below.content;
    out = out.slice(0, idx) + `\\lim_{${sub}}` + out.slice(op.end);
  }
  return out;
}

/**
 * Commandes qui n'apparaissent jamais dans un exercice du périmètre (collège à début du supérieur) mais que
 * pix2tex produit quand il ne sait pas lire : polices exotiques, accents sur des capitales, boîtes et
 * fantômes, tableaux. Une seule suffit pour juger la lecture inexploitable.
 */
const GARBLED_COMMANDS =
  /\\(mathfrak|mathscr|cal|mathcal|jmath|imath|hat|check|breve|acute|grave|ddot|dot|widetilde|tilde|overline|underline|overbrace|underbrace|phantom|vphantom|hphantom|nulldelimiterspace|kern|protect|boxed|fbox|star|oplus|otimes|odot|circledast|wedge|vee|varrho|varsigma|wp|Re|Im|aleph|beth|stackrel|overset|underset|mid|ddots|vdots|bf|it|rm|sf|tt)(?![a-zA-Z])/;

/** Vrai si la lecture de l'OCR est manifestement inexploitable : il ne faut pas la montrer telle quelle. */
export function looksGarbled(latex: string): boolean {
  const s = latex.trim();
  if (!s || s.length > 200) {
    return true; // vide, ou bien trop long pour une ligne d'exercice (sortie qui boucle)
  }
  if (GARBLED_COMMANDS.test(s) || /\\begin\{array\}/.test(s)) {
    return true; // (un système s'écrit \begin{cases} : gardé)
  }
  // indices ou exposants vides ou réduits à un signe : x_{*}, {2-}^{2-}
  return /[_^]\{\s*[*+\-−]?\s*\}|[_^]\{\s*\d*[-+*]\s*\}/.test(s);
}

/** Commandes dont les accolades délimitent un argument (à garder pour comparer) */
const GROUP_ARGS: Record<string, number> = {
  '\\frac': 2,
  '\\sqrt': 1,
  '\\binom': 2,
  '\\begin': 1,
  '\\end': 1,
  '\\operatorname': 1,
  '\\mathrm': 1,
  '\\text': 1,
};

function ungroup(s: string): string {
  let out = '';
  let want = 0;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      const cmd = (s.slice(i).match(/^\\[a-zA-Z]+|^\\./) ?? ['\\'])[0];
      out += cmd;
      i += cmd.length;
      want = GROUP_ARGS[cmd] ?? 0;
    } else if (c === '^' || c === '_') {
      out += c;
      i++;
      want = 1;
    } else if (c === '{') {
      const g = readGroup(s, i);
      if (!g) {
        return out + s.slice(i);
      }
      const inner = ungroup(g.content);
      i = g.end;
      if (want > 0) {
        out += inner.length === 1 ? inner : `{${inner}}`;
        want--;
      } else {
        out += inner;
      }
    } else {
      want = 0;
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Clé de comparaison de deux lectures OCR déjà normalisées : sans espaces, sans \left / \right ni accolades de
 * regroupement (x^{2} et x^2, {\cos(x)} et \cos(x) donnent la même clé ; \frac{ab}{c} et \frac{a}{bc} non).
 * Banc OCR : quand les deux lecteurs du téléphone ont la même clé (267 images sur 300), la lecture est juste.
 */
export function ocrKey(latex: string): string {
  return ungroup((latex || '').replace(/\\(left|right)(?![a-zA-Z])/g, '').replace(/\s+/g, ''));
}
