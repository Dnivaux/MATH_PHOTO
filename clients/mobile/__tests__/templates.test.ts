/**
 * Vérifie la chaîne LaTeX -> CortexJS (MathJSON) -> gabarit SymPy.
 */
import { ComputeEngine } from '@cortex-js/compute-engine';
import { normalizeOcrLatex, preprocessLatex } from '../src/engine/latexPreprocess';
import { buildTemplate, classify } from '../src/engine/templates';
import { UnsupportedExpressionError } from '../src/engine/mathjsonToSympy';

const ce = new ComputeEngine();

function plan(latex: string) {
  const pre = preprocessLatex(latex);
  const json = ce.parse(pre.toParse).json as any;
  return { pre, json, kind: classify(pre, json) };
}

describe('classification', () => {
  test.each([
    ['\\frac{2}{3}+\\frac{5}{6}', 'arithmetic'],
    ['2x+3=7', 'equation'],
    ['x^2-4>0', 'inequality'],
    ['\\frac{d}{dx}\\sin(x)x^2', 'derivative'],
    ['\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(x^3\\right)', 'derivative'],
    ['\\int_0^1 x^2\\,dx', 'integral'],
    ['\\lim_{x\\to0}\\frac{\\sin x}{x}', 'limit'],
    ['\\sum_{k=1}^{10} k^2', 'sum'],
    ['(x+1)^2', 'expression'],
  ])('%s -> %s', (latex, kind) => {
    expect(plan(latex).kind).toBe(kind);
  });
});

describe('gabarits', () => {
  test('équation du second degré', () => {
    const { pre, json } = plan('x^2-5x+6=0');
    const t = buildTemplate(pre, json);
    expect(t.code).toContain('solve(Eq(lhs, rhs), x_)');
    expect(t.wantsPlot).toBe(true);
  });

  test('symboles réservés renommés', () => {
    const { pre, json } = plan('\\lambda + 1');
    expect(buildTemplate(pre, json).code).toContain("lambda_ = Symbol('lambda')");
  });

  test('LaTeX invalide -> escalade', () => {
    const { pre, json } = plan('2\\times(3+4');
    expect(() => buildTemplate(pre, json)).toThrow(UnsupportedExpressionError);
  });

  test('nettoyage des délimiteurs OCR', () => {
    expect(preprocessLatex('$$ x^2 = 4 . $$').cleaned).toBe('x^2 = 4');
  });
});

describe('sortie OCR (Texo) -> LaTeX exploitable', () => {
  test.each([
    ['{ \\boldsymbol { x } } ^ { 2 } - 5 { \\boldsymbol { x } } + { \\boldsymbol { 6 } } = 0', 'equation'],
    ['\\boxed { \\frac { 2 } { 3 } + \\frac { 5 } { 6 } }', 'arithmetic'],
    ['\\operatorname* { l i m } _ { x \\rarr 0 } ~ { \\frac { \\sin x } { x } }', 'limit'],
    ['\\begin{array} { r } { f ( x ) = \\frac { \\sin ( x ) } { x } } \\end{array}', 'expression'],
    ['{ \\frac { d } { d x } } ~ \\left ( x ^ { 2 } e ^ { x } \\right )', 'derivative'],
    ['3 x - 7 = 1 1', 'equation'],
  ])('%s', (raw, kind) => {
    const latex = normalizeOcrLatex(raw);
    const { kind: k, json } = plan(latex);
    expect(ce.parse(preprocessLatex(latex).toParse).isValid).toBe(true);
    expect(k).toBe(kind);
    expect(() => buildTemplate(preprocessLatex(latex), json)).not.toThrow();
  });
});

describe('touches de la calculatrice', () => {
  test.each([
    ['12\\bmod5', 'Mod('],
    ['\\operatorname{gcd}\\left(12,18\\right)', 'gcd('],
    ['\\operatorname{lcm}\\left(4,6\\right)', 'lcm('],
    ['\\operatorname{C}\\left(5,2\\right)', 'binomial('],
    ['\\operatorname{P}\\left(5,2\\right)', 'ff('],
    ['\\left\\lfloor3.7\\right\\rfloor', 'floor('],
    ['\\operatorname{round}\\left(2.5\\right)', 'floor('],
    ['(1+2i)\\times(3-i)', '*I'],
    ['\\sin\\left(30\\degree\\right)', 'sin('],
    ['\\log_2\\left(8\\right)', 'log('],
  ])('%s', (latex, fragment) => {
    const { pre, json } = plan(latex);
    expect(buildTemplate(pre, json).code).toContain(fragment);
  });
});
