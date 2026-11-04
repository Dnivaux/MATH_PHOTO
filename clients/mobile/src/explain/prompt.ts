/**
 * Prompt de l'explainer : copie exacte de MATH_PHOTO/common/prompts.py (EXPLAIN_SYSTEM, EXPLAIN_USER,
 * LEVELS, steps_for_prompt), rendu avec le gabarit de conversation de Qwen3 en mode thinking coupé, comme à
 * l'entraînement (training/llm/sft.py : apply_chat_template(..., enable_thinking=False)).
 *
 * Toute modification côté serveur doit être reportée ici : __tests__/explain.test.ts compare le prompt
 * produit à celui de Python (fixture rendue avec le gabarit lu dans le GGUF).
 */

export type Level = 'college' | 'lycee' | 'superieur';

export const LEVEL_LABELS: Record<Level, string> = {
  college: 'Collège',
  lycee: 'Lycée',
  superieur: 'Supérieur',
};

export const LEVELS: Record<Level, string> = {
  college: 'un élève de collège : phrases courtes, vocabulaire simple, chaque calcul détaillé',
  lycee: 'un élève de lycée : rédaction claire et rigoureuse, vocabulaire mathématique usuel',
  superieur: 'un étudiant du supérieur : rédaction concise, sans détailler les calculs élémentaires',
};

export const EXPLAIN_SYSTEM =
  "Tu es un professeur de mathématiques. Tu rédiges en français l'explication d'une résolution " +
  "à partir d'étapes déjà calculées et vérifiées. Tu ne fais aucun calcul nouveau.";

const EXPLAIN_USER = `Problème : {statement}

Étapes calculées (JSON) :
{steps}

Résultat : \${answer}$

Rédige l'explication pour {level}.
Règles :
- Suis l'ordre des étapes, sans en ajouter ni en supprimer.
- Toute formule est en LaTeX entre $...$. N'écris que des égalités présentes dans les étapes.
- N'introduis aucun nombre absent des étapes.
- Termine par une phrase qui donne le résultat.`;

export interface ExplainProblem {
  /** énoncé en français, au format du générateur (datagen/problems.py : statement_fr) */
  statement_fr: string;
  answer_latex: string;
  steps: { text_fr: string; latex?: string | null }[];
}

/** steps_for_prompt : json.dumps(..., ensure_ascii=False, indent=1) */
export function stepsForPrompt(p: ExplainProblem): string {
  return JSON.stringify(
    p.steps.map(s => ({ texte: s.text_fr, ...(s.latex ? { formule: s.latex } : {}) })),
    null,
    1,
  );
}

export function explainMessages(p: ExplainProblem, level: Level = 'lycee') {
  const user = EXPLAIN_USER.replace('{statement}', () => p.statement_fr)
    .replace('{steps}', () => stepsForPrompt(p))
    .replace('{answer}', () => p.answer_latex)
    .replace('{level}', () => LEVELS[level]);
  return [
    { role: 'system' as const, content: EXPLAIN_SYSTEM },
    { role: 'user' as const, content: user },
  ];
}

/** Gabarit Qwen3 avec add_generation_prompt=True et enable_thinking=False */
export function qwen3Prompt(messages: { role: 'system' | 'user'; content: string }[]): string {
  return messages.map(m => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') + '<|im_start|>assistant\n<think>\n\n</think>\n\n';
}

export const STOP_WORDS = ['<|im_end|>', '<|endoftext|>', '<|im_start|>'];

/**
 * Énoncé au format du générateur, d'après le type et le LaTeX du problème renvoyé par le serveur
 * (datagen/problems.py) : c'est la forme vue à l'entraînement.
 */
export function statementFor(type: string, latex: string): string {
  const body = latex.trim();
  switch (type) {
    case 'equation':
      return `Résoudre dans $\\mathbb{R}$ l'équation $${body}$.`;
    case 'system':
      return `Résoudre le système $${body}$.`;
    case 'derivative': {
      const m = body.match(/^\\frac\{d\}\{dx\}\\left\((.*)\\right\)$/s);
      return m ? `Calculer la dérivée de la fonction $f(x) = ${m[1]}$.` : `Calculer $${body}$.`;
    }
    case 'integral': {
      const m = body.match(/^\\int\s*\\left\((.*)\\right\)\s*\\?,?\s*dx$/s);
      return m ? `Déterminer une primitive de la fonction $f(x) = ${m[1]}$.` : `Calculer $${body}$.`;
    }
    case 'limit':
      return `Calculer la limite $${body}$.`;
    default:
      return `Calculer $${body}$.`;
  }
}
