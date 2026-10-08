/**
 * Pipeline de résolution sur le téléphone :
 *
 *   1. Validation : le LaTeX doit être parsé par CortexJS
 *   2. Cas simple : calcul exact CortexJS
 *   3. Cas courant : gabarit SymPy exécuté sur le téléphone (Pyodide)
 *   4. Sinon escalade : POST /v1/solve (contrat v1 de MATH_PHOTO), avec la raison
 *      (invalid_latex, out_of_local_scope, local_code_failed)
 *
 * Règle centrale : le calcul est toujours fait par CortexJS ou par du code exécuté.
 */
import { getSettings } from '../config';
import { isConclusive, MathEngine, PlotData, PythonRunResult } from '../engine/MathEngine';
import { preprocessLatex } from '../engine/latexPreprocess';
import { UnsupportedExpressionError } from '../engine/mathjsonToSympy';
import { buildTemplate, classify, KIND_LABELS, ProblemKind, TemplatePlan } from '../engine/templates';
import * as api from '../services/api';

export type SolveRoute = 'cortex' | 'sympy-template' | 'server';

export const ROUTE_LABELS: Record<SolveRoute, string> = {
  cortex: 'Calcul exact CortexJS (sur le téléphone)',
  'sympy-template': 'SymPy (sur le téléphone)',
  server: 'Résolu par le serveur',
};

/** Type du contrat v1 correspondant (les autres types n'existent pas encore côté serveur) */
const API_TYPE: Partial<Record<ProblemKind, api.ProblemType>> = {
  equation: 'equation',
  derivative: 'derivative',
  integral: 'integral',
  limit: 'limit',
};

export interface Timing {
  label: string;
  ms: number;
}

export interface CodeAttempt {
  source: 'template' | 'server';
  code: string;
  error?: string;
}

export interface SolveResult {
  inputLatex: string;
  latex: string;
  kind?: ProblemKind;
  kindLabel?: string;
  route: SolveRoute;
  resultLatex: string;
  numericLatex?: string | null;
  steps: { label: string; latex: string }[];
  code?: string;
  plot?: PlotData | null;
  attempts: CodeAttempt[];
  timings: Timing[];
  warnings: string[];
  /** false si le serveur n'a pas pu confirmer le résultat (status « unverified ») */
  verified?: boolean;
  /** variables du problème (pour l'explication) */
  variables?: string[];
}

export class SolveError extends Error {
  constructor(message: string, public attempts: CodeAttempt[], public timings: Timing[]) {
    super(message);
    this.name = 'SolveError';
  }
}

type Progress = (message: string) => void;

async function timed<T>(timings: Timing[], label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ label, ms: Date.now() - t0 });
  }
}

function fromRun(run: PythonRunResult) {
  return {
    resultLatex: run.result_latex ?? '',
    numericLatex: run.numeric_latex,
    steps: run.steps,
    plot: run.plot,
  };
}

export async function solve(inputLatex: string, onProgress: Progress = () => {}): Promise<SolveResult> {
  const settings = getSettings();
  const timings: Timing[] = [];
  const attempts: CodeAttempt[] = [];
  const warnings: string[] = [];
  const pre = preprocessLatex(inputLatex);
  if (!pre.cleaned) throw new SolveError('Expression vide', attempts, timings);

  // 4. Validation
  onProgress('Validation du LaTeX…');
  const parsed = await timed(timings, 'Validation (CortexJS)', () => MathEngine.parse(pre.toParse));

  let kind: ProblemKind | undefined;
  let plan: TemplatePlan | undefined;
  let escalateReason: string | undefined;
  let reason: api.EscalationReason = 'out_of_local_scope';

  if (!parsed.isValid) {
    escalateReason = 'LaTeX non reconnu par le parseur';
    reason = 'invalid_latex';
  } else {
    kind = classify(pre, parsed.json);
    try {
      plan = buildTemplate(pre, parsed.json);
    } catch (e) {
      escalateReason = e instanceof UnsupportedExpressionError ? e.message : String(e);
    }

    // 5a. Cas simple : CortexJS
    if (kind === 'arithmetic') {
      onProgress('Calcul exact…');
      try {
        const ev = await timed(timings, 'Calcul exact (CortexJS)', () => MathEngine.evaluate(pre.toParse));
        if (isConclusive(ev)) {
          return {
            inputLatex,
            latex: pre.cleaned,
            kind,
            kindLabel: KIND_LABELS[kind],
            route: 'cortex',
            resultLatex: ev.exactLatex,
            numericLatex: ev.numericLatex !== ev.exactLatex ? ev.numericLatex : null,
            steps: [
              { label: 'Expression', latex: pre.cleaned },
              { label: 'Valeur exacte', latex: ev.exactLatex },
            ],
            code: plan?.code,
            attempts,
            timings,
            warnings,
          };
        }
      } catch (e) {
        warnings.push(`CortexJS : ${(e as Error).message}`);
      }
    }

    // 5b. Gabarit SymPy
    if (plan) {
      onProgress(MathEngine.status.python === 'ready' ? 'Calcul SymPy…' : 'Chargement de Python (premier lancement)…');
      try {
        const run = await timed(timings, 'Exécution SymPy (Pyodide)', () =>
          MathEngine.runPython(plan!.code, { plot: plan!.wantsPlot }),
        );
        if (run.ok) {
          if (run.plot_error) warnings.push(`Graphe : ${run.plot_error}`);
          return {
            inputLatex,
            latex: pre.cleaned,
            kind,
            kindLabel: KIND_LABELS[kind],
            route: 'sympy-template',
            code: plan.code,
            attempts: [...attempts, { source: 'template', code: plan.code }],
            timings,
            warnings,
            ...fromRun(run),
          };
        }
        attempts.push({ source: 'template', code: plan.code, error: run.error ?? 'erreur' });
        escalateReason = `Le gabarit a échoué : ${run.error}`;
        reason = 'local_code_failed';
      } catch (e) {
        attempts.push({ source: 'template', code: plan.code, error: (e as Error).message });
        escalateReason = (e as Error).message;
        reason = 'local_code_failed';
      }
    }
  }

  // Escalade vers la gateway (contrat v1)
  if (!settings.allowServer) {
    throw new SolveError(`Hors du périmètre local (${escalateReason}) et escalade serveur désactivée`, attempts, timings);
  }
  warnings.push(`Escalade (${reason}) : ${escalateReason}`);
  onProgress('Envoi au serveur…');
  let res: api.SolveResponse;
  try {
    res = await timed(timings, 'Serveur /v1/solve', () =>
      api.solveOnServer({
        latex: pre.cleaned,
        type_hint: kind ? API_TYPE[kind] : undefined,
        escalation: { reason, detail: escalateReason ?? null },
      }),
    );
  } catch (e) {
    throw new SolveError(`Hors du périmètre local et ${(e as Error).message}`, attempts, timings);
  }
  if (res.status === 'error' || !res.result) {
    throw new SolveError(`Serveur : ${res.error?.message ?? 'échec'} (${res.error?.code ?? '?'})`, attempts, timings);
  }
  if (res.status === 'unverified') warnings.push(`Résultat non vérifié par le serveur : ${res.error?.message ?? ''}`);
  if (res.code) attempts.push({ source: 'server', code: res.code.source, error: res.code.status === 'ok' ? undefined : res.code.status });
  return {
    inputLatex,
    latex: res.problem?.latex ?? pre.cleaned,
    kind,
    kindLabel: res.problem?.type ?? (kind ? KIND_LABELS[kind] : 'Problème'),
    route: 'server',
    resultLatex: res.result.latex,
    numericLatex: null,
    steps: res.steps.map(st => ({ label: st.text_fr, latex: st.latex ?? '' })),
    code: res.code?.source,
    plot: null,
    attempts,
    timings,
    warnings,
    verified: res.result.verified && res.status === 'ok',
    variables: res.problem?.variables,
  };
}

/**
 * Explication : le dossier prévoit un LLM de raisonnement sur le téléphone
 * (Qwen3-0.6B via llama.rn, pas encore intégré). En attendant : mode léger,
 * POST /v1/explain sur la gateway.
 */
export async function explainSolution(r: SolveResult): Promise<string | null> {
  if (!getSettings().allowServer) return null;
  const type = r.kind ? API_TYPE[r.kind] : undefined;
  if (!type) throw new Error(`type « ${r.kindLabel} » pas encore prévu par le contrat v1 de l'API`);
  const res = await api.explainOnServer({
    problem: { latex: r.latex, type, variables: r.variables ?? [], route: r.route === 'server' ? 'server' : 'local' },
    steps: r.steps.map((st, i) => ({ index: i + 1, text_fr: st.label, latex: st.latex || null })),
    result: { latex: r.resultLatex, sympy: r.resultLatex, verified: r.verified !== false },
  });
  return res.explanation.text_fr;
}

/** Export .py */
export function toPythonFile(r: SolveResult): string {
  return `# Problème : ${r.latex}\n# Résultat : ${r.resultLatex}\n\n${r.code ?? ''}\n\nprint(latex(result))\n`;
}

/** Export .ipynb (notebook Jupyter minimal) */
export function toNotebook(r: SolveResult): string {
  const src = (s: string) => s.split('\n').map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l));
  return JSON.stringify(
    {
      cells: [
        { cell_type: 'markdown', metadata: {}, source: src(`## Problème\n\n$$${r.latex}$$`) },
        { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: src(r.code ?? '') },
        { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: src('result') },
      ],
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}
