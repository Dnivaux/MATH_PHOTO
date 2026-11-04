/**
 * Moteur embarqué (mathSource.ts) exécuté avec le vrai CortexJS : périmètre local du dossier, étapes au
 * format du générateur, vérification des explications (portage de eval/faithfulness.py).
 */
import { ComputeEngine } from '@cortex-js/compute-engine';
import { MATH_SOURCE } from '../src/engine/mathSource';
import { FUNCTION_PAGES, NUMPAD } from '../src/components/math/calculatorKeys';

// eslint-disable-next-line no-new-func
const makeMath = new Function(`${MATH_SOURCE}; return makeMath;`)();
const math = makeMath(() => new ComputeEngine());

describe('routage (dossier : local = arithmétique et premier degré, le reste au serveur)', () => {
  test.each([
    ['3x-7=11', 'linear', 'local'],
    ['\\frac{x}{2}+1=\\frac{1}{3}', 'linear', 'local'],
    ['\\frac{2}{3}+\\frac{5}{6}', 'arithmetic', 'local'],
    ['\\sqrt{18}+\\left(\\frac{2}{3}\\right)^{2}', 'arithmetic', 'local'],
    ['3\\times47+12\\div4', 'arithmetic', 'local'],
    ['\\sum_{k=1}^{10} k^2', 'arithmetic', 'local'],
    ['2x^{2}-3x-5=0', 'equation', 'server'],
    ['\\begin{cases}2x+y=5\\\\x-y=1\\end{cases}', 'system', 'server'],
    ['\\frac{d}{dx}\\left(x^{2}e^{x}\\right)', 'derivative', 'server'],
    ['\\int x e^{x}\\,dx', 'integral', 'server'],
    ['\\lim_{x\\to0}\\frac{\\sin x}{x}', 'limit', 'server'],
    ['f(x)=\\frac{\\sin(x)}{x}', 'function', 'local'],
    ['x^2-4>0', 'inequality', 'none'],
    ['3x-', 'invalid', 'server'],
  ])('%s -> %s / %s', (latex, kind, route) => {
    const a = math.analyze(latex);
    expect(a.kind).toBe(kind);
    expect(a.route).toBe(route);
  });
});

describe('résultats exacts', () => {
  test.each([
    ['3x-7=11', 'x \\in \\left\\{6\\right\\}'],
    ['2x+3=5x-9', 'x \\in \\left\\{4\\right\\}'],
    ['\\frac{x}{2}+1=\\frac{1}{3}', 'x \\in \\left\\{-\\frac{4}{3}\\right\\}'],
    ['\\frac{2}{3}+\\frac{5}{6}', '\\frac{3}{2}'],
    ['3\\times47+12\\div4', '144'],
    ['\\sin(30\\degree)', '\\frac{1}{2}'],
    ['\\operatorname{nCr}\\left(5,2\\right)', '10'],
    ['\\operatorname{gcd}\\left(12,18\\right)', '6'],
  ])('%s = %s', (latex, expected) => {
    expect(math.analyze(latex).result.latex).toBe(expected);
  });

  test('étapes de l’équation au format de datagen/problems.py:linear_problem', () => {
    const a = math.analyze('3x-7=11');
    expect(a.steps.map((s: any) => s.text_fr)).toEqual([
      'On regroupe les termes en x à gauche et les constantes à droite.',
      'On divise les deux membres par 3.',
      "L'équation admet une unique solution : $x = 6$.",
    ]);
    expect(a.steps.map((s: any) => s.latex)).toEqual(['3x = 18', 'x = 6', null]);
    expect(a.statement).toBe("Résoudre dans $\\mathbb{R}$ l'équation $3x-7=11$.");
  });

  test('valeur approchée à la française', () => {
    expect(math.analyze('\\frac{1}{7}').result.numeric).toBe('0{,}1428571429');
  });
});

describe('vérification des explications', () => {
  const eq = { ptype: 'equation', vars: ['x'], solutions: [{ x: 6 }], answers: [6], sources: ['3x-7=11', '3x = 18', 'x = 6'] };

  test('explication juste : acceptée', () => {
    const r = math.checkExplanation({ ...eq, text: 'On regroupe : $3x = 18$. On divise par 3 : $x = 6$. La solution est $x = 6$.' });
    expect(r).toMatchObject({ fail: 0, accept: true, finalStated: true, hallucinated: [] });
  });

  test('égalité fausse et nombres inventés : refusée', () => {
    const r = math.checkExplanation({ ...eq, text: 'On regroupe : $3x = 18$. Donc $x = 5$, et $4 \\times 2 = 9$.' });
    expect(r.accept).toBe(false);
    expect(r.failures).toEqual(['x = 5', '4 \\times 2 = 9']);
    expect(r.hallucinated).toEqual(expect.arrayContaining(['5', '9']));
  });

  test('second degré : x_1, x_2 et discriminant vérifiés', () => {
    const r = math.checkExplanation({
      ptype: 'equation',
      vars: ['x'],
      solutions: [{ x: -1 }, { x: 2.5 }],
      answers: [-1, 2.5],
      sources: ['2x^{2}-3x-5=0', '\\Delta = 49', 'x_1 = \\frac{3 - \\sqrt{49}}{4} = -1', 'x_2 = \\frac{3 + \\sqrt{49}}{4} = \\frac{5}{2}'],
      text: 'Les solutions sont $x_1 = \\frac{3 - 7}{4} = -1$ et $x_2 = \\frac{3+7}{4} = \\frac{5}{2}$.',
    });
    expect(r).toMatchObject({ fail: 0, accept: true });
  });

  test('primitive : égale à une constante près', () => {
    const r = math.checkExplanation({
      ptype: 'integral',
      vars: ['x'],
      integrand: 'x e^{x}',
      sources: [],
      text: 'On trouve $x e^{x} - e^{x} + C = e^{x}(x-1) + C$.',
    });
    expect(r).toMatchObject({ ok: 1, fail: 0, finalStated: true });
  });

  test('un calcul précédent ne change pas le sens de C (moteur neuf à chaque vérification)', () => {
    math.analyze('\\operatorname{nCr}\\left(5,2\\right)');
    const r = math.checkExplanation({
      ptype: 'integral',
      vars: ['x'],
      integrand: '2x',
      sources: [],
      text: '$x^{2} + C = x \\times x + C$',
    });
    expect(r.ok).toBe(1);
  });
});

describe('touches de la calculatrice', () => {
  // chaque gabarit, emplacements remplis, doit être lu par le moteur
  const fill = (t: string) => t.replace(/#@/g, '3').replace(/#0/g, '2').replace(/#\?/g, '2');
  const keys = [...NUMPAD.flat(), ...FUNCTION_PAGES.flatMap(p => p.rows.flat())].filter(
    k => !['=', ',', '(', ')', '+', '-', '\\times', '\\div', '.'].includes(k.insert),
  );
  test.each(keys.map(k => [k.id, k.insert]))('%s : %s', (_id, insert) => {
    const t = insert as string;
    const latex = /^\\(pi|infty)$|^[xye]$/.test(t) ? t : t === 'f(x)=' ? 'f(x)=x^{2}' : /^\\bmod/.test(t) ? `7${t}2` : fill(t);
    expect(math.isValid(latex)).toBe(true);
  });
});

describe('explication réelle du modèle embarqué (émulateur, second degré)', () => {
  // texte rédigé par explainer-0.6b-p20 sur l'émulateur, à partir des étapes du serveur
  const text =
    "On commence par identifier les coefficients de l'équation $2x^2 - 3x - 5 = 0$. On note $a = 2$, $b = -3$ et $c = -5$. " +
    "On calcule ensuite le discriminant $\\Delta$ de l'équation : $$\\Delta = b^2 - 4ac = (-3)^2 - 4 \\times 2 \\times (-5) = 49$$ " +
    "Le discriminant est strictement positif, donc l'équation admet deux solutions réelles. La première solution est : " +
    '$$x_1 = \\frac{-b - \\sqrt{\\Delta}}{2a} = \\frac{3 - \\sqrt{49}}{4} = -1$$ La seconde solution est : ' +
    '$$x_2 = \\frac{-b + \\sqrt{\\Delta}}{2a} = \\frac{3 + \\sqrt{49}}{4} = \\frac{5}{2}$$ ' +
    'Les solutions sont $x = -1$ et $x = \\frac{5}{2}$. Ainsi, $x \\in \\left\\{-1 ; \\frac{5}{2}\\right\\}$.';
  const ctx = {
    text,
    ptype: 'equation',
    vars: ['x'],
    solutions: [{ x: -1 }, { x: 2.5 }],
    answers: [-1, 2.5],
    sources: [
      '2 x^{2} - 3 x - 5 = 0',
      'On identifie a = 2, b = -3, c = -5 et on calcule le discriminant.',
      '\\Delta = b^{2} - 4ac = \\left(-3\\right)^{2} - 4 \\times 2 \\times \\left(-5\\right) = 49',
      'x_1 = \\frac{3 - \\sqrt{49}}{4} = -1',
      'x_2 = \\frac{3 + \\sqrt{49}}{4} = \\frac{5}{2}',
    ],
  };

  test('sans les valeurs des étapes : vérification partielle', () => {
    expect(math.checkExplanation({ ...ctx }).accept).toBe(false);
  });

  test('avec a, b, c et Delta tirés des étapes : vérifiée', () => {
    const r = math.checkExplanation({ ...ctx, symbols: { a: 2, b: -3, c: -5, Delta: 49 } });
    expect(r).toMatchObject({ fail: 0, accept: true, finalStated: true, hallucinated: [] });
  });
});

describe('garde-fou : le serveur a-t-il répondu pour la formule envoyée ?', () => {
  test.each([
    ['x^2=4', 'x^{2} = 4', 'equation', true],
    ['x^2-5x+6=0', '2 x^{2} - 10 x + 12 = 0', 'equation', true],
    ['x^2-5x+6=0', '2 x^{2} - 3 x - 5 = 0', 'equation', false],
    ['x^{2}+x-6=0', '2 x^{2} - 3 x - 5 = 0', 'equation', false],
    ['\\frac{d}{dx}(x^2e^x)', '\\frac{d}{dx}\\left(x^{2} e^{x}\\right)', 'derivative', true],
    ['\\frac{d}{dx}(\\sin x)', '\\frac{d}{dx}\\left(x^{2} e^{x}\\right)', 'derivative', false],
    ['\\int x e^{x}\\,dx', '\\int \\left(x e^{x}\\right) dx', 'integral', true],
    ['\\begin{cases}x+y=1\\\\x-y=0\\end{cases}', 'x + y = 1 \\\\ x - y = 0', 'system', true],
  ])('%s / %s (%s) -> %s', (sent, received, type, expected) => {
    expect(math.sameProblem(sent, received, type)).toBe(expected);
  });
});
