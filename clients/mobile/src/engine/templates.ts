/**
 * Gabarits SymPy : pour les cas courants, le code Python est généré ici,
 * sans LLM. Chaque gabarit respecte le contrat lu par le runner Pyodide :
 *
 *   steps      : liste de (libellé, objet SymPy ou chaîne LaTeX)
 *   result     : objet SymPy (ou liste) du résultat final
 *   result_latex (optionnel) : rendu LaTeX imposé du résultat
 *   plot_var, plot_exprs, plot_range (optionnels) : graphe Matplotlib
 */
import {
  MathJson,
  UnsupportedExpressionError,
  declarations,
  freeSymbols,
  newContext,
  toSympy,
  ConversionContext,
} from './mathjsonToSympy';
import { PreprocessedLatex } from './latexPreprocess';

export type ProblemKind =
  | 'arithmetic'
  | 'equation'
  | 'inequality'
  | 'derivative'
  | 'integral'
  | 'limit'
  | 'sum'
  | 'expression';

export const KIND_LABELS: Record<ProblemKind, string> = {
  arithmetic: 'Calcul numérique',
  equation: 'Équation',
  inequality: 'Inéquation',
  derivative: 'Dérivée',
  integral: 'Intégrale',
  limit: 'Limite',
  sum: 'Somme',
  expression: 'Expression algébrique',
};

export interface TemplatePlan {
  kind: ProblemKind;
  code: string;
  wantsPlot: boolean;
}

const HEADER = 'from sympy import *';

const PREFERRED_VARS = ['x', 'y', 't', 'z', 'n'];

function pickVariable(vars: string[]): string | undefined {
  return PREFERRED_VARS.find(v => vars.includes(v)) ?? vars[0];
}

function head(e: MathJson): string | undefined {
  return Array.isArray(e) && typeof e[0] === 'string' ? (e[0] as string) : undefined;
}

/** f(x) = … : étude de fonction plutôt qu'équation */
function isFunctionDefinition(lhs: MathJson): boolean {
  const h = head(lhs);
  return h !== undefined && /^[a-z]$/.test(h) && (lhs as MathJson[]).length === 2 && typeof (lhs as MathJson[])[1] === 'string';
}

/** Détermine le type de problème à partir du MathJSON */
export function classify(pre: PreprocessedLatex, json: MathJson): ProblemKind {
  if (pre.derivative) return 'derivative';
  const h = head(json);
  if (h === 'Equal') return isFunctionDefinition((json as MathJson[])[1]) ? 'expression' : 'equation';
  if (h && ['Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(h)) return 'inequality';
  if (h === 'Integrate') return 'integral';
  if (h === 'Limit') return 'limit';
  if (h === 'Sum' || h === 'Product') return 'sum';
  return freeSymbols(json).length === 0 ? 'arithmetic' : 'expression';
}

/** Corps et variable d'un ["Function", ["Block", corps], "x"] */
function unwrapFunction(e: MathJson): { body: MathJson; variable?: string } {
  if (head(e) === 'Function') {
    const arr = e as MathJson[];
    return { body: arr[1], variable: typeof arr[2] === 'string' ? (arr[2] as string) : undefined };
  }
  return { body: e };
}

function lines(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join('\n');
}

/**
 * Construit le code SymPy du gabarit. Lève UnsupportedExpressionError si
 * l'expression sort du périmètre des gabarits (=> escalade LLM).
 */
export function buildTemplate(pre: PreprocessedLatex, json: MathJson): TemplatePlan {
  const kind = classify(pre, json);
  const ctx = newContext();
  const body = buildBody(kind, pre, json, ctx);
  const code = lines(HEADER, '', declarations(ctx), '', body.code);
  return { kind, code, wantsPlot: body.wantsPlot };
}

function buildBody(
  kind: ProblemKind,
  pre: PreprocessedLatex,
  json: MathJson,
  ctx: ConversionContext,
): { code: string; wantsPlot: boolean } {
  const c = (e: MathJson) => toSympy(e, ctx);

  switch (kind) {
    case 'arithmetic': {
      const e = c(json);
      return {
        wantsPlot: false,
        code: lines(
          'with evaluate(False):',
          `    expr = ${e}`,
          'steps = [("Expression", expr)]',
          'result = simplify(expr)',
          'steps.append(("Valeur exacte", result))',
        ),
      };
    }

    case 'equation': {
      const [, lhsJ, rhsJ] = json as MathJson[];
      const vars = freeSymbols(json);
      const v = pickVariable(vars);
      const lhs = c(lhsJ);
      const rhs = c(rhsJ);
      if (!v) {
        return {
          wantsPlot: false,
          code: lines(
            `lhs = ${lhs}`,
            `rhs = ${rhs}`,
            'steps = [("Égalité à vérifier", Eq(lhs, rhs, evaluate=False))]',
            'diff_ = simplify(lhs - rhs)',
            'steps.append(("Différence des deux membres", diff_))',
            'result = (diff_ == 0)',
            'result_latex = r"\\text{Vrai}" if result else r"\\text{Faux}"',
          ),
        };
      }
      const x = toSympy(v, ctx);
      const single = vars.length === 1;
      return {
        wantsPlot: single,
        code: lines(
          `x_ = ${x}`,
          `lhs = ${lhs}`,
          `rhs = ${rhs}`,
          'steps = [("Équation de départ", Eq(lhs, rhs, evaluate=False))]',
          'g = expand(lhs - rhs)',
          'if rhs != 0:',
          '    steps.append(("On ramène tout dans le membre de gauche", Eq(g, 0, evaluate=False)))',
          'fg = factor(g)',
          'if fg != g:',
          '    steps.append(("Factorisation", Eq(fg, 0, evaluate=False)))',
          'num = numer(together(g))',
          'if num.is_polynomial(x_) and Poly(num, x_).degree() == 2:',
          '    a_, b_, c_ = Poly(num, x_).all_coeffs()',
          '    steps.append(("Discriminant Δ = b² − 4ac", Eq(Symbol("Delta"), simplify(b_**2 - 4*a_*c_))))',
          'solutions = solve(Eq(lhs, rhs), x_)',
          'checks = [simplify(lhs.subs(x_, s) - rhs.subs(x_, s)) == 0 for s in solutions]',
          'if solutions:',
          '    steps.append(("Vérification par substitution", r"\\text{" + ("toutes les solutions vérifient l\'équation" if all(checks) else "certaines solutions ne vérifient pas l\'équation") + "}"))',
          'real_only = [s for s in solutions if s.is_real]',
          'complex_sols = [s for s in solutions if s.is_real is False]',
          'if complex_sols:',
          '    steps.append(("Solutions complexes (non réelles)", r",\\ ".join(latex(x_) + " = " + latex(s) for s in complex_sols)))',
          'result = solutions',
          'if real_only:',
          '    result_latex = r",\\ ".join(latex(x_) + " = " + latex(s) for s in real_only)',
          'elif complex_sols:',
          '    result_latex = r"\\text{Aucune solution réelle}"',
          'elif solutions:',
          '    result_latex = r",\\ ".join(latex(x_) + " = " + latex(s) for s in solutions)',
          'else:',
          '    result_latex = r"\\text{Aucune solution}"',
          single && 'plot_var = x_',
          single && 'plot_exprs = [("gauche − droite", g)]',
          single && 'real_sols = [float(s) for s in solutions if s.is_real]',
          single && 'plot_range = (min(real_sols + [0]) - 5, max(real_sols + [0]) + 5)',
          single && 'plot_points = [(latex(x_) + " = " + latex(s), s, 0) for s in solutions if s.is_real]',
        ),
      };
    }

    case 'inequality': {
      const vars = freeSymbols(json);
      const v = pickVariable(vars);
      if (!v || vars.length > 1) throw new UnsupportedExpressionError('Inéquation à plusieurs inconnues');
      const x = toSympy(v, ctx);
      const rel = c(json);
      return {
        wantsPlot: true,
        code: lines(
          `x_ = ${x}`,
          `rel = ${rel}`,
          'steps = [("Inéquation de départ", rel)]',
          'g = expand(rel.lhs - rel.rhs)',
          'steps.append(("On ramène tout dans le membre de gauche", rel.func(g, 0)))',
          'fg = factor(g)',
          'if fg != g:',
          '    steps.append(("Factorisation", rel.func(fg, 0)))',
          'roots_ = solve(Eq(g, 0), x_)',
          'if roots_:',
          '    steps.append(("Valeurs qui annulent le membre de gauche", r",\\ ".join(latex(r) for r in roots_)))',
          'result = solve_univariate_inequality(rel.func(g, 0), x_, relational=False)',
          'steps.append(("Étude du signe", result))',
          'result_latex = latex(x_) + r" \\in " + latex(result)',
          'plot_var = x_',
          'plot_exprs = [("gauche − droite", g)]',
          'real_r = [float(r) for r in roots_ if r.is_real]',
          'plot_range = (min(real_r + [0]) - 5, max(real_r + [0]) + 5)',
          'plot_points = [(latex(x_) + " = " + latex(r), r, 0) for r in roots_ if r.is_real]',
        ),
      };
    }

    case 'derivative': {
      const d = pre.derivative!;
      const x = toSympy(d.variable, ctx);
      const f = c(json);
      const single = freeSymbols(json).filter(s => s !== d.variable).length === 0;
      return {
        wantsPlot: single,
        code: lines(
          `x_ = ${x}`,
          `f = ${f}`,
          `order = ${d.order}`,
          'steps = [("Fonction à dériver", f)]',
          'rule = None',
          'if order == 1:',
          '    if f.is_Add: rule = r"(u+v)\' = u\' + v\'"',
          '    elif f.is_Mul and len([a for a in f.args if a.has(x_)]) > 1:',
          '        dens = [a for a in f.args if a.is_Pow and a.exp.is_negative and a.has(x_)]',
          '        rule = r"\\left(\\frac{u}{v}\\right)\' = \\frac{u\'v - uv\'}{v^2}" if dens else r"(uv)\' = u\'v + uv\'"',
          '    elif f.is_Pow and f.base.has(x_) and not f.exp.has(x_): rule = r"(u^n)\' = n\\,u\'\\,u^{n-1}"',
          '    elif f.is_Function and f.args[0] != x_: rule = r"(g \\circ u)\' = u\' \\cdot g\'(u)"',
          'if rule:',
          '    steps.append(("Règle de dérivation utilisée", rule))',
          'd = diff(f, x_, order)',
          'steps.append(("Dérivation", Eq(Derivative(f, (x_, order)), d, evaluate=False)))',
          'ds = simplify(d)',
          'if ds != d:',
          '    steps.append(("Simplification", ds))',
          'result = ds',
          single && 'plot_var = x_',
          single && 'plot_exprs = [("f", f), ("dérivée", ds)]',
        ),
      };
    }

    case 'integral': {
      const arr = json as MathJson[];
      const { body, variable } = unwrapFunction(arr[1]);
      const limits = arr[2] as MathJson[] | undefined;
      const v = variable ?? (limits && typeof limits[1] === 'string' ? (limits[1] as string) : 'x');
      const x = toSympy(v, ctx);
      const f = c(body);
      const lo = limits && limits[2] !== undefined && limits[2] !== 'Nothing' ? c(limits[2]) : undefined;
      const hi = limits && limits[3] !== undefined && limits[3] !== 'Nothing' ? c(limits[3]) : undefined;
      const single = freeSymbols(body).filter(s => s !== v).length === 0;
      if (lo !== undefined && hi !== undefined) {
        return {
          wantsPlot: single,
          code: lines(
            `x_ = ${x}`,
            `f = ${f}`,
            `a, b = ${lo}, ${hi}`,
            'steps = [("Intégrale à calculer", Integral(f, (x_, a, b)))]',
            'F = integrate(f, x_)',
            'if not F.has(Integral):',
            '    steps.append(("Primitive", Eq(Function("F")(x_), F, evaluate=False)))',
            '    steps.append(("Évaluation aux bornes", r"\\left[" + latex(F) + r"\\right]_{" + latex(a) + "}^{" + latex(b) + "}"))',
            'result = simplify(integrate(f, (x_, a, b)))',
            'steps.append(("Résultat", result))',
            single && 'plot_var = x_',
            single && 'plot_exprs = [("f", f)]',
            single && 'plot_range = (float(a) - 1, float(b) + 1) if a.is_finite and b.is_finite else None',
          ),
        };
      }
      return {
        wantsPlot: false,
        code: lines(
          `x_ = ${x}`,
          `f = ${f}`,
          'steps = [("Intégrande", f)]',
          'F = integrate(f, x_)',
          'steps.append(("Recherche d\'une primitive", Eq(Integral(f, x_), F, evaluate=False)))',
          'result = simplify(F)',
          'result_latex = latex(result) + " + C"',
        ),
      };
    }

    case 'limit': {
      const arr = json as MathJson[];
      const { body, variable } = unwrapFunction(arr[1]);
      const v = variable ?? pickVariable(freeSymbols(body)) ?? 'x';
      const x = toSympy(v, ctx);
      const f = c(body);
      const a = c(arr[2]);
      return {
        wantsPlot: false,
        code: lines(
          `x_ = ${x}`,
          `f = ${f}`,
          `a = ${a}`,
          'two_sided = bool(a.is_finite)',
          'steps = [("Limite à calculer", Limit(f, x_, a, dir="+-") if two_sided else Limit(f, x_, a))]',
          'try:',
          '    direct = f.subs(x_, a)',
          'except Exception:',
          '    direct = nan',
          'if direct.has(nan, zoo) or direct is nan:',
          '    steps.append(("Substitution directe", r"\\text{forme indéterminée}"))',
          'else:',
          '    steps.append(("Substitution directe", direct))',
          'if two_sided:',
          '    l_right, l_left = limit(f, x_, a, "+"), limit(f, x_, a, "-")',
          '    if l_right == l_left:',
          '        result = l_right',
          '    else:',
          '        steps.append(("Limites à gauche et à droite", r"\\lim_{x \\to a^-} = " + latex(l_left) + r",\\quad \\lim_{x \\to a^+} = " + latex(l_right)))',
          '        result = [l_left, l_right]',
          '        result_latex = r"\\text{pas de limite (gauche et droite différentes)}"',
          'else:',
          '    result = limit(f, x_, a)',
          'steps.append(("Résultat", result))',
        ),
      };
    }

    case 'sum': {
      const arr = json as MathJson[];
      const op = arr[0] === 'Product' ? 'product' : 'summation';
      const { body } = unwrapFunction(arr[1]);
      const limits = arr[2] as MathJson[] | undefined;
      if (!limits || typeof limits[1] !== 'string') throw new UnsupportedExpressionError('Bornes de somme absentes');
      const k = toSympy(limits[1] as string, ctx);
      return {
        wantsPlot: false,
        code: lines(
          `k_ = ${k}`,
          `f = ${c(body)}`,
          `lo, hi = ${c(limits[2])}, ${c(limits[3])}`,
          `steps = [("Expression", ${op === 'summation' ? 'Sum' : 'Product'}(f, (k_, lo, hi)))]`,
          `result = simplify(${op}(f, (k_, lo, hi)))`,
          'steps.append(("Résultat", result))',
        ),
      };
    }

    case 'expression': {
      // f(x) = … : étude de la fonction
      if (head(json) === 'Equal' && isFunctionDefinition((json as MathJson[])[1])) {
        const [, lhsJ, rhsJ] = json as MathJson[];
        const v = (lhsJ as MathJson[])[1] as string;
        return expressionStudy(c(rhsJ), toSympy(v, ctx), `${head(lhsJ)}(${v})`);
      }
      const vars = freeSymbols(json);
      const v = vars.length === 1 ? toSympy(vars[0], ctx) : undefined;
      return expressionStudy(c(json), v);
    }
  }
}

function expressionStudy(expr: string, variable?: string, name?: string): { code: string; wantsPlot: boolean } {
  return {
    wantsPlot: !!variable,
    code: lines(
      `expr = ${expr}`,
      `steps = [(${JSON.stringify(name ? `Fonction ${name}` : 'Expression')}, expr)]`,
      'e_exp = expand(expr)',
      'if e_exp != expr:',
      '    steps.append(("Développement", e_exp))',
      'e_fac = factor(expr)',
      'if e_fac != expr and e_fac != e_exp:',
      '    steps.append(("Factorisation", e_fac))',
      'result = simplify(expr)',
      'if result != expr and result not in (e_exp, e_fac):',
      '    steps.append(("Forme simplifiée", result))',
      variable && `plot_var = ${variable}`,
      variable && 'plot_exprs = [("f", expr)]',
    ),
  };
}
