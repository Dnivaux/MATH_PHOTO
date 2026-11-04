import type { FaithfulnessReport, PlotData, ProblemKind, Step } from '../engine/MathEngine';
import type { ApiProblemType } from '../engine/MathEngine';
import type { EscalationReason } from '../services/api';
import type { Level } from '../explain/prompt';

export interface Timing {
  label: string;
  ms: number;
}

export interface Explanation {
  text: string;
  level: Level;
  /** téléphone (LLM embarqué) ou serveur (mode léger) */
  source: 'device' | 'server';
  report?: FaithfulnessReport | null;
  tokensPerSecond?: number;
  at: number;
}

/** Résultat d'une résolution, tel qu'affiché et enregistré dans l'historique */
export interface Solution {
  latex: string;
  kind: ProblemKind;
  kindLabel: string;
  apiType?: ApiProblemType;
  /** qui a calculé : CortexJS sur le téléphone ou la gateway */
  route: 'local' | 'server';
  result: { latex: string; numeric: string | null } | null;
  /** résultat confirmé par un moteur exact (CortexJS) ou par la double vérification du serveur */
  verified: boolean;
  steps: Step[];
  plot: PlotData | null;
  /** pour l'explainer : énoncé au format du générateur */
  statement?: string;
  variables: string[];
  /** valeurs numériques du résultat, pour la vérification de l'explication */
  answers: number[];
  solutions: Record<string, number>[];
  noRealSolution?: boolean;
  answerFn?: string;
  integrand?: string;
  escalation?: { reason: EscalationReason; detail?: string | null };
  warnings: string[];
  timings: Timing[];
  explanation?: Explanation;
}

export type SolveErrorCode = 'invalid' | 'unsupported' | 'disabled' | 'offline' | 'server' | 'empty';

export class SolveError extends Error {
  constructor(
    message: string,
    public code: SolveErrorCode,
    public queued = false,
  ) {
    super(message);
    this.name = 'SolveError';
  }
}

export const KIND_LABELS: Record<string, string> = {
  arithmetic: 'Calcul',
  check: 'Égalité à vérifier',
  linear: 'Équation du premier degré',
  equation: 'Équation',
  system: 'Système d’équations',
  derivative: 'Dérivée',
  integral: 'Primitive',
  limit: 'Limite',
  function: 'Fonction',
  inequality: 'Inéquation',
  expression: 'Expression',
  invalid: 'Formule',
  empty: 'Formule',
};
