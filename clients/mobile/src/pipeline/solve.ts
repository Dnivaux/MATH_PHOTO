/**
 * Résolution (dossier, « Version téléphone ») :
 *
 *   1. Validation : le LaTeX doit être lu par CortexJS.
 *   2. Cas simple (arithmétique, fractions, puissances, racines, équation du premier degré) : CortexJS,
 *      calcul exact sur le téléphone, étapes au format du générateur du serveur.
 *   3. Sinon escalade vers la gateway (POST /v1/solve), avec la raison : invalid_latex, out_of_local_scope,
 *      ocr_low_confidence (confiance OCR sous le seuil), user_request (« Vérifier avec le serveur »).
 *   4. Hors ligne : le problème est mis en file d'attente et envoyé au retour du réseau (queue.ts).
 *
 * Règle centrale : le résultat vient toujours de CortexJS ou du code exécuté et vérifié par le serveur.
 * Le téléphone n'affiche pas de code Python (dossier) : want_code = false.
 */
import { getSettings } from '../config';
import { Analysis, MathEngine, PlotData } from '../engine/MathEngine';
import { cleanLatex } from '../engine/latexPreprocess';
import { statementFor } from '../explain/prompt';
import * as api from '../services/api';
import { logEvent } from '../storage/db';
import { KIND_LABELS, Solution, SolveError, Timing } from './types';

export interface SolveOptions {
  ocrConfidence?: number | null;
  /** « Vérifier avec le serveur » : escalade demandée par l'utilisateur */
  forceServer?: boolean;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

async function timed<T>(timings: Timing[], label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ label, ms: Date.now() - t0 });
  }
}

const UNSUPPORTED: Record<string, string> = {
  inequality: 'Les inéquations ne sont pas encore prises en charge.',
  expression: 'Cette expression contient plusieurs variables : je ne sais pas encore la traiter.',
  arithmetic: 'Je n’ai pas réussi à calculer cette expression.',
};

function localSolution(latex: string, a: Analysis, timings: Timing[]): Solution {
  return {
    latex,
    kind: a.kind,
    kindLabel: a.label ?? KIND_LABELS[a.kind],
    apiType: a.apiType,
    route: 'local',
    result: a.result ?? null,
    verified: !!a.result,
    steps: a.steps ?? [],
    plot: a.plot ?? null,
    statement: a.statement,
    variables: a.variable ? [a.variable] : [],
    answers: (a.answers ?? []).filter((v): v is number => typeof v === 'number'),
    solutions: a.variable && a.solutions ? a.solutions.filter((v): v is number => v !== null).map(v => ({ [a.variable!]: v })) : [],
    warnings: [],
    timings,
  };
}

function localFallback(latex: string, a: Analysis, timings: Timing[], warning: string): Solution {
  const sol = localSolution(latex, a, timings);
  sol.warnings.push(warning);
  return sol;
}

/** x \in \left\{a ; b\right\} -> [a, b] ; x = 1, \; y = 2 -> [[x, 1], [y, 2]] */
export function splitSolutions(resultLatex: string): string[] {
  const m = resultLatex.match(/\\left\\\{(.*)\\right\\\}/s);
  if (!m) {
    return [];
  }
  return m[1]
    .split(/\s*;\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function splitSystem(resultLatex: string): [string, string][] {
  return resultLatex
    .split(/,\s*(?:\\;\s*)?/)
    .map(p => p.split('='))
    .filter(p => p.length === 2)
    .map(p => [p[0].trim(), p[1].trim()] as [string, string]);
}

function inner(latex: string, re: RegExp): string | undefined {
  const m = latex.match(re);
  return m ? m[1].trim() : undefined;
}

/** Courbes du graphe pour un problème résolu par le serveur (calculées ensuite sur le téléphone) */
function serverPlot(type: string, problemLatex: string, resultLatex: string, solutions: number[]): PlotData | null {
  const v = 'x';
  const curves: { label: string; latex: string }[] = [];
  if (type === 'derivative') {
    const f = inner(problemLatex, /^\\frac\{d\}\{dx\}\\left\((.*)\\right\)$/s) ?? inner(problemLatex, /^\\frac\{d\}\{dx\}\s*(.*)$/s);
    if (f) {
      curves.push({ label: 'f(x)', latex: f });
    }
    curves.push({ label: 'f′(x)', latex: resultLatex.replace(/^f'\(x\)\s*=\s*/, '') });
  } else if (type === 'integral') {
    const f =
      inner(problemLatex, /^\\int\s*\\left\((.*)\\right\)\s*\\?,?\s*dx$/s) ?? inner(problemLatex, /^\\int\s*(.*?)\s*\\?,?\s*d\s*x$/s);
    if (f) {
      curves.push({ label: 'f(x)', latex: f });
    }
    curves.push({ label: 'F(x)', latex: resultLatex.replace(/\+\s*C\s*$/, '').replace(/^F\(x\)\s*=\s*/, '') });
  } else if (type === 'limit') {
    const f = inner(problemLatex, /^\\lim_\{[^}]*\}\s*(.*)$/s);
    if (f) {
      curves.push({ label: 'f(x)', latex: f });
    }
  } else if (type === 'equation' && problemLatex.includes('=')) {
    const [l, r] = problemLatex.split('=');
    curves.push({ label: 'membre de gauche', latex: l }, { label: 'membre de droite', latex: r });
  }
  if (!curves.length) {
    return null;
  }
  return { var: v, curves, points: solutions.map(x => ({ label: `x = ${Math.round(x * 1000) / 1000}`, x, y: NaN })) };
}

async function fromServer(latex: string, res: api.SolveResponse, timings: Timing[], escalation: Solution['escalation']): Promise<Solution> {
  if (!res.result || !res.problem) {
    throw new SolveError(api.errorMessage(res.error?.code, res.error?.message), 'server');
  }
  const type = res.problem.type;
  // garde-fou : une réponse pour une autre formule (serveur défaillant, gateway factice) n'est pas affichée
  if (res.problem.latex && !(await MathEngine.sameProblem(latex, res.problem.latex, type).catch(() => true))) {
    throw new SolveError(
      `Le serveur a répondu pour une autre formule (${res.problem.latex}) : sa réponse a été écartée. Réessaie, ou corrige la formule.`,
      'server',
    );
  }
  const resultLatex = res.result.latex;
  const sol: Solution = {
    latex: res.problem.latex || latex,
    kind: type,
    kindLabel: KIND_LABELS[type] ?? 'Problème',
    apiType: type,
    route: 'server',
    result: { latex: resultLatex, numeric: null },
    verified: res.status === 'ok' && res.result.verified,
    steps: res.steps.map(s => ({ text_fr: s.text_fr, latex: s.latex ?? null })),
    plot: null,
    statement: statementFor(type, res.problem.latex || latex),
    variables: res.problem.variables?.length ? res.problem.variables : ['x'],
    answers: [],
    solutions: [],
    escalation,
    warnings: res.status === 'unverified' ? ['Le serveur n’a pas pu confirmer ce résultat par une seconde méthode.'] : [],
    timings,
  };
  if (type === 'equation') {
    if (/\\emptyset|\\varnothing/.test(resultLatex)) {
      sol.noRealSolution = true;
    }
    const vals = (await MathEngine.values(splitSolutions(resultLatex))).filter((v): v is number => v !== null);
    sol.answers = vals;
    sol.solutions = vals.map(v => ({ [sol.variables[0]]: v }));
  } else if (type === 'system') {
    const pairs = splitSystem(resultLatex);
    const vals = await MathEngine.values(pairs.map(p => p[1]));
    const s: Record<string, number> = {};
    pairs.forEach((p, i) => {
      if (vals[i] !== null) {
        s[p[0]] = vals[i] as number;
      }
    });
    sol.solutions = Object.keys(s).length ? [s] : [];
    sol.answers = Object.values(s);
    sol.variables = pairs.map(p => p[0]);
  } else if (type === 'limit') {
    sol.answers = (await MathEngine.values([resultLatex])).filter((v): v is number => v !== null);
  } else if (type === 'derivative') {
    sol.answerFn = resultLatex.replace(/^f'\(x\)\s*=\s*/, '');
  } else if (type === 'integral') {
    sol.integrand =
      inner(sol.latex, /^\\int\s*\\left\((.*)\\right\)\s*\\?,?\s*dx$/s) ?? inner(sol.latex, /^\\int\s*(.*?)\s*\\?,?\s*d\s*x$/s);
  }
  if (sol.variables.length <= 1) {
    sol.plot = serverPlot(type, sol.latex, resultLatex, sol.answers);
  }
  return sol;
}

export async function solve(input: string, opts: SolveOptions = {}): Promise<Solution> {
  const settings = getSettings();
  const progress = opts.onProgress ?? (() => {});
  const timings: Timing[] = [];
  const latex = cleanLatex(input);
  if (!latex) {
    throw new SolveError('La formule est vide.', 'empty');
  }

  progress('Lecture de la formule…');
  const a = await timed(timings, 'Analyse (CortexJS)', () => MathEngine.analyze(latex));
  const lowConfidence = opts.ocrConfidence != null && opts.ocrConfidence < settings.ocrMinConfidence;

  let reason: api.EscalationReason | null = null;
  let detail: string | null = null;
  if (opts.forceServer) {
    reason = 'user_request';
  } else if (a.route === 'local' && lowConfidence && settings.allowServer && a.apiType) {
    // le serveur ne traite que les types du contrat (pas l'arithmétique) : il contrôle l'équation lue
    reason = 'ocr_low_confidence';
    detail = `confiance OCR ${opts.ocrConfidence}`;
  } else if (a.route === 'local') {
    logEvent('solve', { route: 'local', kind: a.kind, ms: timings[0]?.ms });
    const sol = localSolution(latex, a, timings);
    if (lowConfidence) {
      sol.warnings.push('La photo a été lue avec peu de certitude : vérifie que la formule affichée est bien la tienne.');
    }
    return sol;
  } else if (a.route === 'server') {
    reason = a.valid ? 'out_of_local_scope' : 'invalid_latex';
    detail = a.valid ? (a.label ?? a.kind) : 'LaTeX non reconnu par CortexJS';
  } else {
    throw new SolveError(
      a.reason && a.kind === 'arithmetic'
        ? UNSUPPORTED.arithmetic
        : (UNSUPPORTED[a.kind] ?? 'Ce problème n’est pas encore pris en charge.'),
      'unsupported',
    );
  }

  if (!settings.allowServer) {
    throw new SolveError(
      a.valid
        ? 'Ce problème se résout sur le serveur. Active l’envoi au serveur dans les réglages.'
        : 'Je n’ai pas compris la formule. Corrige-la, ou active l’envoi au serveur dans les réglages.',
      a.valid ? 'disabled' : 'invalid',
    );
  }

  const escalation = { reason, detail };
  progress('Envoi au serveur…');
  logEvent('escalation', { reason, kind: a.kind, ocrConfidence: opts.ocrConfidence ?? null });
  let res: api.SolveResponse;
  try {
    res = await timed(timings, 'Serveur /v1/solve', () =>
      api.solveOnServer(
        {
          latex,
          type_hint: a.apiType,
          escalation: { reason: reason!, detail, ocr_confidence: opts.ocrConfidence ?? null },
        },
        opts.signal,
      ),
    );
  } catch (e) {
    // dernier recours : si le calcul local était possible (OCR peu sûr, demande de vérification), on le garde
    if (a.route === 'local' && !opts.signal?.aborted) {
      return localFallback(
        latex,
        a,
        timings,
        'Le serveur est injoignable : résultat calculé sur le téléphone, à partir de la formule lue.',
      );
    }
    if (e instanceof api.ServerError && (e.kind === 'network' || e.kind === 'timeout') && !opts.signal?.aborted) {
      throw new SolveError('Pas de connexion au serveur.', 'offline');
    }
    throw new SolveError((e as Error).message, 'server');
  }
  if (res.status === 'error') {
    if (a.route === 'local') {
      return localFallback(
        latex,
        a,
        timings,
        `Le serveur n’a pas pu contrôler ce calcul (${api.errorMessage(res.error?.code)}) : résultat calculé sur le téléphone.`,
      );
    }
    throw new SolveError(api.errorMessage(res.error?.code, res.error?.message), 'server');
  }
  const sol = await fromServer(latex, res, timings, escalation);
  logEvent('solve', { route: 'server', kind: sol.kind, reason, verified: sol.verified, ms: res.timings?.total_ms });
  return sol;
}
