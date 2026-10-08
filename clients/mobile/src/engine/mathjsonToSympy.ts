/**
 * Conversion MathJSON (sortie du parseur CortexJS) -> code Python SymPy.
 *
 * Seules les constructions connues sont converties ; toute tête inconnue lève
 * une UnsupportedExpressionError, ce qui déclenche l'escalade vers le LLM.
 */

export type MathJson = number | string | { num: string } | { sym: string } | MathJson[] | Record<string, any>;

export class UnsupportedExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedExpressionError';
  }
}

/** Noms Python / SymPy qu'un symbole utilisateur ne doit pas écraser */
const RESERVED = new Set([
  // mots-clés Python
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  // noms SymPy fréquents
  'E', 'I', 'N', 'O', 'S', 'Q', 'C', 'pi', 'oo', 'zoo', 'nan', 'beta', 'gamma', 'zeta', 'sin', 'cos',
  'tan', 'exp', 'log', 'ln', 'sqrt', 'diff', 'limit', 'solve', 'symbols', 'Symbol', 'Function', 'Eq',
  'latex', 'simplify', 'factor', 'expand', 'integrate', 'Integral', 'Derivative', 'Poly', 'Rational',
  'steps', 'result', 'result_latex', 'plot_exprs', 'plot_var', 'plot_range', 'lhs', 'rhs', 'f', 'g',
]);

const FUNCTIONS_1: Record<string, string> = {
  Sin: 'sin', Cos: 'cos', Tan: 'tan', Cot: 'cot', Sec: 'sec', Csc: 'csc',
  Arcsin: 'asin', Arccos: 'acos', Arctan: 'atan', Arccot: 'acot',
  Sinh: 'sinh', Cosh: 'cosh', Tanh: 'tanh', Arsinh: 'asinh', Arcosh: 'acosh', Artanh: 'atanh',
  Ln: 'log', Exp: 'exp', Abs: 'Abs', Floor: 'floor', Ceil: 'ceiling', Factorial: 'factorial',
  Sqrt: 'sqrt', Sign: 'sign', Conjugate: 'conjugate', Re: 're', Im: 'im',
};

const CONSTANTS: Record<string, string> = {
  Pi: 'pi',
  ExponentialE: 'E',
  ImaginaryUnit: 'I',
  PositiveInfinity: 'oo',
  NegativeInfinity: '(-oo)',
  ComplexInfinity: 'zoo',
  Half: 'Rational(1, 2)',
};

export interface ConversionContext {
  /** nom MathJSON -> nom de variable Python */
  symbols: Map<string, string>;
  /** fonctions inconnues appliquées, ex. f(x) */
  functions: Map<string, string>;
}

export function newContext(): ConversionContext {
  return { symbols: new Map(), functions: new Map() };
}

export function pyName(name: string): string {
  let n = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(n)) n = `s_${n}`;
  if (RESERVED.has(n)) n = `${n}_`;
  return n;
}

function symbol(ctx: ConversionContext, name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new UnsupportedExpressionError(`Symbole non supporté : ${name}`);
  }
  if (!ctx.symbols.has(name)) ctx.symbols.set(name, pyName(name));
  return ctx.symbols.get(name)!;
}

function numberLiteral(value: number | string): string {
  const s = String(value).trim();
  if (/^[+-]?\d+$/.test(s)) return `Integer(${s})`;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return `Rational('${s}')`;
  if (s === 'NaN') throw new UnsupportedExpressionError('NaN');
  if (s === '+Infinity' || s === 'Infinity') return 'oo';
  if (s === '-Infinity') return '(-oo)';
  // notation à répétition de CortexJS, ex. 0.(3)
  const rep = s.match(/^([+-]?\d+)\.(\d*)\((\d+)\)$/);
  if (rep) return `nsimplify(Rational('${rep[1]}.${rep[2]}${rep[3].repeat(6)}'), rational=True)`;
  throw new UnsupportedExpressionError(`Nombre non reconnu : ${s}`);
}

/** Convertit une expression MathJSON en expression Python SymPy */
export function toSympy(expr: MathJson, ctx: ConversionContext): string {
  if (typeof expr === 'number') return numberLiteral(expr);

  if (typeof expr === 'string') {
    if (expr.startsWith("'")) throw new UnsupportedExpressionError(`Texte non mathématique : ${expr}`);
    if (CONSTANTS[expr]) return CONSTANTS[expr];
    if (/^[+-]?\d/.test(expr)) return numberLiteral(expr);
    if (expr === 'Nothing') throw new UnsupportedExpressionError('Expression vide');
    return symbol(ctx, expr);
  }

  if (!Array.isArray(expr)) {
    if ('num' in expr) return numberLiteral(expr.num);
    if ('sym' in expr) return toSympy(expr.sym, ctx);
    if ('fn' in expr) return toSympy(expr.fn, ctx);
    throw new UnsupportedExpressionError(`Noeud inconnu : ${JSON.stringify(expr)}`);
  }

  const [head, ...args] = expr as [string, ...MathJson[]];
  if (typeof head !== 'string') throw new UnsupportedExpressionError('Tête non textuelle');
  const c = (e: MathJson) => toSympy(e, ctx);
  const all = () => args.map(c);

  switch (head) {
    case 'Add':
      return `(${all().join(' + ')})`;
    case 'Subtract':
      return args.length === 1 ? `(-${c(args[0])})` : `(${c(args[0])} - ${c(args[1])})`;
    case 'Negate':
      return `(-${c(args[0])})`;
    case 'Multiply':
      return `(${all().join('*')})`;
    case 'Divide':
      return `(${c(args[0])})/(${c(args[1])})`;
    case 'Rational':
      return args.length === 2 ? `Rational(${c(args[0])}, ${c(args[1])})` : `nsimplify(${c(args[0])})`;
    case 'Power':
      return `(${c(args[0])})**(${c(args[1])})`;
    case 'Square':
      return `(${c(args[0])})**2`;
    case 'Root':
      return `root(${c(args[0])}, ${c(args[1])})`;
    case 'Log':
      // CortexJS : Log(x) = log10, Log(x, b) = log en base b
      return args.length === 2 ? `log(${c(args[0])}, ${c(args[1])})` : `log(${c(args[0])}, 10)`;
    case 'Lg':
      return `log(${c(args[0])}, 10)`;
    case 'Lb':
      return `log(${c(args[0])}, 2)`;
    case 'Binomial':
      return `binomial(${c(args[0])}, ${c(args[1])})`;
    case 'Mod':
      return `Mod(${c(args[0])}, ${c(args[1])})`;
    case 'GCD':
      return args.length === 2 ? `gcd(${c(args[0])}, ${c(args[1])})` : `gcd_list([${all().join(', ')}])`;
    case 'LCM':
      return args.length === 2 ? `lcm(${c(args[0])}, ${c(args[1])})` : `lcm_list([${all().join(', ')}])`;
    case 'C':
    case 'nCr':
    case 'Choose':
      return `binomial(${c(args[0])}, ${c(args[1])})`;
    case 'P':
    case 'nPr':
      // arrangements : n! / (n-k)!
      return `ff(${c(args[0])}, ${c(args[1])})`;
    case 'Round':
      return `floor(${c(args[0])} + Rational(1, 2))`;
    case 'Complex':
      return `(${c(args[0])} + ${c(args[1])}*I)`;
    case 'Argument':
      return `arg(${c(args[0])})`;
    case 'OverBar':
      return `conjugate(${c(args[0])})`;
    case 'Max':
      return `Max(${all().join(', ')})`;
    case 'Min':
      return `Min(${all().join(', ')})`;
    case 'Delimiter': {
      const inner = args[0];
      if (Array.isArray(inner) && inner[0] === 'Sequence' && inner.length === 2) return `(${c(inner[1])})`;
      if (Array.isArray(inner) && inner[0] === 'Sequence') {
        throw new UnsupportedExpressionError('Séquence entre parenthèses');
      }
      return `(${c(inner)})`;
    }
    case 'Block':
      if (args.length !== 1) throw new UnsupportedExpressionError('Bloc multiple');
      return c(args[0]);
    case 'Hold':
      return c(args[0]);
    case 'Equal':
      return `Eq(${c(args[0])}, ${c(args[1])})`;
    case 'Less':
      return `(${c(args[0])} < ${c(args[1])})`;
    case 'LessEqual':
      return `(${c(args[0])} <= ${c(args[1])})`;
    case 'Greater':
      return `(${c(args[0])} > ${c(args[1])})`;
    case 'GreaterEqual':
      return `(${c(args[0])} >= ${c(args[1])})`;
    case 'NotEqual':
      return `Ne(${c(args[0])}, ${c(args[1])})`;
    case 'Error':
    case 'Sequence':
    case 'LatexString':
      throw new UnsupportedExpressionError('LaTeX non interprétable');
    default:
      break;
  }

  if (FUNCTIONS_1[head]) {
    if (args.length !== 1) throw new UnsupportedExpressionError(`${head} attend un argument`);
    return `${FUNCTIONS_1[head]}(${c(args[0])})`;
  }

  // Fonction utilisateur appliquée, ex. ["f", "x"]
  if (/^[a-z][A-Za-z0-9_]*$/.test(head) && args.length >= 1) {
    if (!ctx.functions.has(head)) ctx.functions.set(head, `${pyName(head)}_fn`);
    return `${ctx.functions.get(head)}(${all().join(', ')})`;
  }

  throw new UnsupportedExpressionError(`Opération non gérée par les gabarits : ${head}`);
}

/** Déclarations Python des symboles et fonctions rencontrés */
export function declarations(ctx: ConversionContext): string {
  const lines: string[] = [];
  for (const [name, py] of ctx.symbols) lines.push(`${py} = Symbol('${name}')`);
  for (const [name, py] of ctx.functions) lines.push(`${py} = Function('${name}')`);
  return lines.join('\n');
}

/** Variables libres (ordre d'apparition) d'une expression MathJSON */
export function freeSymbols(expr: MathJson, bound: Set<string> = new Set()): string[] {
  const out: string[] = [];
  const visit = (e: MathJson, b: Set<string>) => {
    if (typeof e === 'string') {
      if (!e.startsWith("'") && !CONSTANTS[e] && /^[A-Za-z][A-Za-z0-9_]*$/.test(e) && e !== 'Nothing' && !b.has(e) && !out.includes(e)) {
        out.push(e);
      }
      return;
    }
    if (!Array.isArray(e)) return;
    const [head, ...args] = e as [string, ...MathJson[]];
    if (head === 'Function') {
      const vars = new Set(b);
      args.slice(1).forEach(v => typeof v === 'string' && vars.add(v));
      visit(args[0], vars);
      return;
    }
    if (head === 'Limits' || head === 'Tuple') {
      args.slice(1).forEach(a => visit(a, b));
      return;
    }
    if ((head === 'Sum' || head === 'Product') && args.length >= 2) {
      const lim = args[1];
      const v = Array.isArray(lim) && typeof lim[1] === 'string' ? lim[1] : undefined;
      const nb = new Set(b);
      if (v) nb.add(v);
      visit(args[0], nb);
      args.slice(1).forEach(a => visit(a, b));
      return;
    }
    args.forEach(a => visit(a, b));
  };
  visit(expr, bound);
  return out;
}
