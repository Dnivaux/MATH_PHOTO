/**
 * Touches de la calculatrice. `insert` est un gabarit MathLive :
 *   #@ = ce qui précède le curseur (x² met au carré le terme précédent)
 *   #0 = la sélection ou un emplacement vide, #? = emplacement vide
 *
 * Le libellé est structuré (exposant, indice, fraction) et rendu par KeyLabel : pas de caractères Unicode en
 * exposant, dont le rendu varie selon les polices des téléphones.
 * Seules figurent les fonctions que le moteur traite (CortexJS sur le téléphone, ou le serveur).
 */
export type KeyKind = 'digit' | 'op' | 'fn' | 'var';

export type KeyLabel = string | { base: string; sup?: string; sub?: string; pre?: string } | { num: string; den: string };

export interface CalcKey {
  id: string;
  label: KeyLabel;
  insert: string;
  kind: KeyKind;
  /** libellé lu par TalkBack */
  a11y: string;
}

const k = (id: string, label: KeyLabel, insert: string, kind: KeyKind, a11y: string): CalcKey => ({ id, label, insert, kind, a11y });

/** Pavé fixe : chiffres, opérations, x et π */
export const NUMPAD: CalcKey[][] = [
  [
    k('7', '7', '7', 'digit', '7'),
    k('8', '8', '8', 'digit', '8'),
    k('9', '9', '9', 'digit', '9'),
    k('div', '÷', '\\div', 'op', 'divisé par'),
    k('lp', '(', '(', 'op', 'parenthèse ouvrante'),
  ],
  [
    k('4', '4', '4', 'digit', '4'),
    k('5', '5', '5', 'digit', '5'),
    k('6', '6', '6', 'digit', '6'),
    k('mul', '×', '\\times', 'op', 'multiplié par'),
    k('rp', ')', ')', 'op', 'parenthèse fermante'),
  ],
  [
    k('1', '1', '1', 'digit', '1'),
    k('2', '2', '2', 'digit', '2'),
    k('3', '3', '3', 'digit', '3'),
    k('sub', '−', '-', 'op', 'moins'),
    k('eq', '=', '=', 'op', 'égal'),
  ],
  [
    k('0', '0', '0', 'digit', '0'),
    k('dot', '.', '.', 'digit', 'virgule décimale'),
    k('x', 'x', 'x', 'var', 'x'),
    k('add', '+', '+', 'op', 'plus'),
    k('pi', 'π', '\\pi', 'var', 'pi'),
  ],
];

export interface KeyPage {
  id: string;
  title: string;
  rows: CalcKey[][];
}

/** Deux rangées de fonctions, selon l'onglet */
export const FUNCTION_PAGES: KeyPage[] = [
  {
    id: 'algebra',
    title: 'Algèbre',
    rows: [
      [
        k('frac', { num: 'a', den: 'b' }, '\\frac{#@}{#?}', 'fn', 'fraction'),
        k('sq', { base: 'x', sup: '2' }, '#@^{2}', 'fn', 'au carré'),
        k('pow', { base: 'x', sup: 'y' }, '#@^{#?}', 'fn', 'puissance'),
        k('sqrt', '√', '\\sqrt{#0}', 'fn', 'racine carrée'),
        k('root', { pre: 'n', base: '√' }, '\\sqrt[#?]{#0}', 'fn', 'racine n-ième'),
      ],
      [
        k('abs', '|x|', '\\left|#0\\right|', 'fn', 'valeur absolue'),
        k('fact', 'n!', '#@!', 'fn', 'factorielle'),
        k('ncr', { base: 'C', sub: 'n,k' }, '\\operatorname{nCr}\\left(#?,#?\\right)', 'fn', 'combinaisons de k parmi n'),
        k('mod', 'mod', '\\bmod ', 'fn', 'reste de la division'),
        k('comma', ',', ',', 'op', 'séparateur d’arguments'),
      ],
    ],
  },
  {
    id: 'functions',
    title: 'Fonctions',
    rows: [
      [
        k('sin', 'sin', '\\sin\\left(#0\\right)', 'fn', 'sinus'),
        k('cos', 'cos', '\\cos\\left(#0\\right)', 'fn', 'cosinus'),
        k('tan', 'tan', '\\tan\\left(#0\\right)', 'fn', 'tangente'),
        k('ln', 'ln', '\\ln\\left(#0\\right)', 'fn', 'logarithme népérien'),
        k('log', 'log', '\\log\\left(#0\\right)', 'fn', 'logarithme décimal'),
      ],
      [
        k('asin', 'arcsin', '\\arcsin\\left(#0\\right)', 'fn', 'arc sinus'),
        k('acos', 'arccos', '\\arccos\\left(#0\\right)', 'fn', 'arc cosinus'),
        k('atan', 'arctan', '\\arctan\\left(#0\\right)', 'fn', 'arc tangente'),
        k('loga', { base: 'log', sub: 'a' }, '\\log_{#0}\\left(#?\\right)', 'fn', 'logarithme en base a'),
        k('exp', { base: 'e', sup: 'x' }, 'e^{#0}', 'fn', 'exponentielle'),
      ],
    ],
  },
  {
    id: 'analysis',
    title: 'Analyse',
    rows: [
      [
        k('deriv', { num: 'd', den: 'dx' }, '\\frac{d}{dx}\\left(#0\\right)', 'fn', 'dérivée'),
        k('int', '∫', '\\int #0\\,dx', 'fn', 'primitive'),
        k('lim', 'lim', '\\lim_{x\\to #0}#?', 'fn', 'limite'),
        k('sum', 'Σ', '\\sum_{k=#0}^{#?}#?', 'fn', 'somme'),
        k('inf', '∞', '\\infty', 'var', 'infini'),
      ],
      [
        k('sys', 'système', '\\begin{cases}#0\\\\#?\\end{cases}', 'fn', 'système de deux équations'),
        k('fx', 'f(x) =', 'f(x)=', 'var', 'définir une fonction à tracer'),
        k('gcd', 'PGCD', '\\operatorname{gcd}\\left(#?,#?\\right)', 'fn', 'plus grand commun diviseur'),
        k('lcm', 'PPCM', '\\operatorname{lcm}\\left(#?,#?\\right)', 'fn', 'plus petit commun multiple'),
        k('y', 'y', 'y', 'var', 'y'),
      ],
    ],
  },
];
