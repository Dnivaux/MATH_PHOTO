/**
 * Nettoyage de la sortie OCR de pix2tex et lecture des réponses du serveur.
 */
import { normalizeOcrLatex } from '../src/engine/latexPreprocess';
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
