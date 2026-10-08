/**
 * Touches de la calculatrice. `insert` est un gabarit MathLive :
 *   #@ = ce qui précède le curseur (ex. x² met au carré le terme précédent)
 *   #0 = la sélection ou un emplacement vide, #? = emplacement vide
 */
export type KeyKind = 'digit' | 'op' | 'fn' | 'var' | 'cmp';

export interface CalcKey {
  label: string;
  insert: string;
  kind: KeyKind;
  /** libellé accessible / aide */
  hint?: string;
}

const k = (label: string, insert: string, kind: KeyKind = 'fn', hint?: string): CalcKey => ({ label, insert, kind, hint });

export interface KeyPage {
  id: string;
  title: string;
  rows: CalcKey[][];
}

export const KEY_PAGES: KeyPage[] = [
  {
    id: 'base',
    title: '123',
    rows: [
      [k('x', 'x', 'var'), k('y', 'y', 'var'), k('a⁄b', '\\frac{#@}{#?}', 'fn', 'fraction'), k('x²', '#@^{2}'), k('xʸ', '#@^{#?}', 'fn', 'puissance')],
      [k('7', '7', 'digit'), k('8', '8', 'digit'), k('9', '9', 'digit'), k('÷', '\\div', 'op'), k('√', '\\sqrt{#0}', 'fn', 'racine carrée')],
      [k('4', '4', 'digit'), k('5', '5', 'digit'), k('6', '6', 'digit'), k('×', '\\times', 'op'), k('(', '(', 'op')],
      [k('1', '1', 'digit'), k('2', '2', 'digit'), k('3', '3', 'digit'), k('−', '-', 'op'), k(')', ')', 'op')],
      [k('0', '0', 'digit'), k('.', '.', 'digit', 'virgule décimale'), k('π', '\\pi', 'var'), k('+', '+', 'op'), k('=', '=', 'cmp')],
    ],
  },
  {
    id: 'functions',
    title: 'f(x)',
    rows: [
      [k('sin', '\\sin\\left(#0\\right)'), k('cos', '\\cos\\left(#0\\right)'), k('tan', '\\tan\\left(#0\\right)'), k('ln', '\\ln\\left(#0\\right)'), k('log', '\\log\\left(#0\\right)', 'fn', 'logarithme décimal')],
      [k('sin⁻¹', '\\arcsin\\left(#0\\right)'), k('cos⁻¹', '\\arccos\\left(#0\\right)'), k('tan⁻¹', '\\arctan\\left(#0\\right)'), k('logₐ', '\\log_{#0}\\left(#?\\right)', 'fn', 'logarithme en base a'), k('eˣ', 'e^{#0}')],
      [k('sinh', '\\sinh\\left(#0\\right)'), k('cosh', '\\cosh\\left(#0\\right)'), k('tanh', '\\tanh\\left(#0\\right)'), k('|x|', '\\left|#0\\right|', 'fn', 'valeur absolue'), k('ⁿ√', '\\sqrt[#?]{#0}', 'fn', 'racine n-ième')],
      [k('n!', '#@!', 'fn', 'factorielle'), k('nCr', '\\operatorname{C}\\left(#?,#?\\right)', 'fn', 'combinaisons'), k('nPr', '\\operatorname{P}\\left(#?,#?\\right)', 'fn', 'arrangements'), k('mod', '\\bmod ', 'op', 'reste de la division'), k('10ˣ', '10^{#0}')],
      [k('PGCD', '\\operatorname{gcd}\\left(#?,#?\\right)'), k('PPCM', '\\operatorname{lcm}\\left(#?,#?\\right)'), k('⌊x⌋', '\\left\\lfloor #0\\right\\rfloor', 'fn', 'partie entière'), k('⌈x⌉', '\\left\\lceil #0\\right\\rceil', 'fn', 'arrondi supérieur'), k(',', ',', 'op', 'séparateur d’arguments')],
    ],
  },
  {
    id: 'analysis',
    title: '∫ lim',
    rows: [
      [k('d/dx', '\\frac{d}{dx}\\left(#0\\right)', 'fn', 'dérivée'), k('∫', '\\int #0\\,dx', 'fn', 'primitive'), k('∫ₐᵇ', '\\int_{#0}^{#?}#?\\,dx', 'fn', 'intégrale'), k('lim', '\\lim_{x\\to #0}#?', 'fn', 'limite'), k('Σ', '\\sum_{k=#0}^{#?}#?', 'fn', 'somme')],
      [k('∏', '\\prod_{k=#0}^{#?}#?', 'fn', 'produit'), k('∞', '\\infty', 'var'), k('e', 'e', 'var'), k('°', '\\degree', 'op', 'degrés'), k('%', '\\%', 'op', 'pourcentage')],
      [k('<', '<', 'cmp'), k('>', '>', 'cmp'), k('≤', '\\le', 'cmp'), k('≥', '\\ge', 'cmp'), k('f(x)=', 'f(x)=', 'var', 'définir une fonction')],
      [k('i', 'i', 'var', 'unité imaginaire'), k('Re', '\\operatorname{Re}\\left(#0\\right)'), k('Im', '\\operatorname{Im}\\left(#0\\right)'), k('z̄', '\\overline{#0}', 'fn', 'conjugué'), k('arg', '\\arg\\left(#0\\right)', 'fn', 'argument')],
      [k('t', 't', 'var'), k('n', 'n', 'var'), k('k', 'k', 'var'), k('θ', '\\theta', 'var'), k('arrondi', '\\operatorname{round}\\left(#0\\right)')],
    ],
  },
];
