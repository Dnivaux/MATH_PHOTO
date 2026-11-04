/**
 * Nettoyage de la sortie OCR de pix2tex et lecture des réponses du serveur.
 */
import { looksGarbled, normalizeOcrLatex } from '../src/engine/latexPreprocess';
import { splitSolutions, splitSystem } from '../src/pipeline/solve';

describe('sortie OCR (pix2tex) -> LaTeX exploitable', () => {
  test.each([
    ['3X-7=11', '3x-7=11'],
    ['\\chi^{2}-5\\chi+6=0', 'x^{2}-5x+6=0'],
    ['\\textstyle\\int\\!\\chi e^{x}\\,d\\chi', '\\int x e^{x} dx'],
    ['\\operatorname*{lim}_{x\\to0}{\\frac{\\sin x}{x}}', '\\lim_{x\\to 0}{\\frac{\\sin x}{x}}'],
    ['{\\frac{2}{3}}+{\\frac{5}{6}}', '{\\frac{2}{3}}+{\\frac{5}{6}}'],
    ['f(X)={\\frac{\\sin(x)}{x}}', 'f(X)={\\frac{\\sin(x)}{x}}'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeOcrLatex(raw)).toBe(expected);
  });
});

describe('réponses du serveur (datagen : answer_latex)', () => {
  test('solutions d’une équation', () => {
    expect(splitSolutions('x \\in \\left\\{2 ; 3\\right\\}')).toEqual(['2', '3']);
    expect(splitSolutions('x \\in \\left\\{- \\frac{1}{2}\\right\\}')).toEqual(['- \\frac{1}{2}']);
    expect(splitSolutions('\\emptyset')).toEqual([]);
  });
  test('solution d’un système', () => {
    expect(splitSystem('x = 2, \\; y = 1')).toEqual([
      ['x', '2'],
      ['y', '1'],
    ]);
  });
});

describe('valeurs nommées dans les étapes du serveur', () => {
  test('coefficients et discriminant', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { stepSymbols } = require('../src/pipeline/explain');
    expect(
      stepSymbols([
        { text_fr: 'On identifie a = 2, b = -3, c = -5 et on calcule le discriminant.', latex: '\\Delta = b^{2} - 4ac = 49' },
        { text_fr: 'Première solution.', latex: 'x_1 = -1' },
      ]),
    ).toEqual({ a: 2, b: -3, c: -5, Delta: 49 });
  });
});

describe('message d’erreur après relecture serveur', () => {
  it('montre ce que le serveur a lu sur la photo', () => {
    const { errorMessage } = require('../src/services/api');
    const m = errorMessage('unsupported_type', 'inconnue autre que x : {a, b, c} (photo relue par le serveur : x=\\frac{-b}{2a})');
    expect(m).toContain('pas encore pris en charge');
    expect(m).toContain('Le serveur a lu sur la photo : x=\\frac{-b}{2a}');
    expect(errorMessage('unsupported_type', 'autre')).toBe('Ce type de problème n’est pas encore pris en charge.');
  });
});

describe('lecture OCR inexploitable : jamais montrée telle quelle', () => {
  test.each([
    // sorties réelles de pix2tex sur des photos (S24 Ultra, 4 novembre)
    ['{\\mathfrak{c}}_{*}\\(x_{*}{\\overline{{\\jmath}}})_{2-}(2x_{*}{\\5})_{2-}^{2-}{\\mathfrak{b}}'],
    ['\\begin{array}{c}{{x=\\frac{\\hat{U}\\hat{U}\\hat{U}}{\\oplus}}}\\end{array}'],
    ['7{{\\cal X}}{{\\cal X}}+\\overline{{{{\\cal Y}}}}=-6{{\\cal X}}-2\\protect'],
    [''],
  ])('%s', latex => {
    expect(looksGarbled(latex)).toBe(true);
  });
  test.each([
    ['2x^{2}-3x-5=0'],
    ['\\frac{2}{3}+\\frac{5}{6}'],
    ['\\int x e^{x} dx'],
    ['\\lim_{x\\to 0}\\frac{\\sin x}{x}'],
    ['\\sqrt{18}+\\left(\\frac{2}{3}\\right)^{2}'],
    ['x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'],
    ['\\frac{d}{dx}\\left(x^{3}\\cos x\\right)'],
    ['\\begin{cases}2x+y=5\\\\x-y=1\\end{cases}'],
  ])('%s est gardée', latex => {
    expect(looksGarbled(latex)).toBe(false);
  });
});

describe('sorties réelles de pix2text-mfr (banc du 4 novembre) -> LaTeX que le moteur comprend', () => {
  const { ComputeEngine } = require('@cortex-js/compute-engine');
  const { MATH_SOURCE } = require('../src/engine/mathSource');
  // eslint-disable-next-line no-new-func
  const math = new Function(`${MATH_SOURCE}; return makeMath;`)()(() => new ComputeEngine());
  test.each([
    ['\\underset { \\mathrm { x \\to 0 } } { \\operatorname* { l i m } } \\, \\frac { \\operatorname { s i n } { \\left( 7 x \\right) } } { x }', // \u : pas de String.raw (séquence d'échappement)
      String.raw`\lim_{x\to 0}\frac{\sin {\left(7x\right)}}{x}`, 'limit'],
    [String.raw`= \operatorname* { l i m } _ { x \to \infty } { \frac { - 2 x ^ { 3 } + 4 x - 4 } { 3 x ^ { 3 } + x ^ { 2 } + 4 x + 5 } }`,
      String.raw`\lim_{x\to \infty}{\frac{-2x^{3}+4x-4}{3x^{3}+x^{2}+4x+5}}`, 'limit'],
    [String.raw`\frac { \mathrm { d } } { \mathrm { d } x } ( - 3 \operatorname { s i n } { ( x ) } + \frac { \operatorname { c o s } { ( 2 x ) } } { 2 } )`,
      String.raw`\frac{d}{dx}(-3\sin {(x)}+\frac{\cos {(2x)}}{2})`, 'derivative'],
    [String.raw`\frac { d } { d x } ( 4 \mathsf { c o s } \left( x \right) + 4 \mathsf { c o s } \left( 3 x \right) )`,
      String.raw`\frac{d}{dx}(4\cos \left(x\right)+4\cos \left(3x\right))`, 'derivative'],
    [String.raw`\frac { d } { d x } \bigl ( \frac { x ^ { 4 } } { 2 } + \frac { \operatorname { s i n } { ( 2 x ) } } { 2 } \bigr )`,
      String.raw`\frac{d}{dx}(\frac{x^{4}}{2}+\frac{\sin {(2x)}}{2})`, 'derivative'],
    [String.raw`\int _ { } ^ { } ( x \mathrm { e } ^ { 3 x } - x \mathrm { s i n } \left( x \right) + x \mathrm { c o s } \left( x \right) ) d x`,
      String.raw`\int(xe^{3x}-x\sin \left(x\right)+x\cos \left(x\right))dx`, 'integral'],
    [String.raw`x ^ { 2 } - 5 x + 6 = 0`, 'x^{2}-5x+6=0', 'equation'],
  ])('%s', (raw, expected, kind) => {
    const latex = normalizeOcrLatex(raw);
    expect(latex).toBe(expected);
    expect(looksGarbled(latex)).toBe(false);
    expect(math.analyze(latex).kind).toBe(kind);
  });
});
