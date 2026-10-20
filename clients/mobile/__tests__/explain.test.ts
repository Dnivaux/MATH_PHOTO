/**
 * Le prompt envoyé à l'explainer doit être exactement celui de l'entraînement : fixture produite par
 * common/prompts.py et le gabarit de conversation lu dans le GGUF (enable_thinking=False).
 */
import fixtures from './fixtures/explain_prompts.json';
import { explainMessages, qwen3Prompt, statementFor } from '../src/explain/prompt';

describe('prompt de l’explainer', () => {
  test.each(fixtures.map((f: any, i: number) => [i, f]))('cas %i : identique à Python', (_i, f: any) => {
    expect(explainMessages(f.problem, f.level)).toEqual(f.messages);
    expect(qwen3Prompt(explainMessages(f.problem, f.level))).toBe(f.prompt);
  });
});

describe('énoncé au format du générateur', () => {
  test.each([
    ['equation', 'x^{2} - 5 x + 6 = 0', "Résoudre dans $\\mathbb{R}$ l'équation $x^{2} - 5 x + 6 = 0$."],
    ['derivative', '\\frac{d}{dx}\\left(x^{2} e^{x}\\right)', 'Calculer la dérivée de la fonction $f(x) = x^{2} e^{x}$.'],
    ['integral', '\\int \\left(x e^{x}\\right) dx', 'Déterminer une primitive de la fonction $f(x) = x e^{x}$.'],
    [
      'limit',
      '\\lim_{x \\to 0} \\frac{\\sin{\\left(x \\right)}}{x}',
      'Calculer la limite $\\lim_{x \\to 0} \\frac{\\sin{\\left(x \\right)}}{x}$.',
    ],
  ])('%s', (type, latex, expected) => {
    expect(statementFor(type, latex)).toBe(expected);
  });
});
