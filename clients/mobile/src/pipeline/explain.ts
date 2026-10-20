/**
 * Explication d'une solution (dossier : rédigée sur le téléphone ; serveur seulement en mode léger).
 *
 *   complet + modèle présent : LLM embarqué (llama.rn), hors ligne ;
 *   léger, ou modèle absent  : POST /v1/explain si l'envoi au serveur est autorisé.
 *
 * Dans les deux cas, chaque égalité du texte est revérifiée sur le téléphone (CortexJS) et les nombres
 * absents des étapes sont signalés : l'écran affiche « vérifiée » seulement si tout concorde.
 */
import { getSettings } from '../config';
import { effectiveMode } from '../device';
import { FaithfulnessContext, MathEngine } from '../engine/MathEngine';
import { generateExplanation, stopExplanation } from '../explain/explainer';
import { getModelState } from '../explain/modelStore';
import { ExplainProblem, Level } from '../explain/prompt';
import * as api from '../services/api';
import { logEvent } from '../storage/db';
import { Explanation, Solution } from './types';

const EXPLAINABLE = new Set(['arithmetic', 'linear', 'equation', 'system', 'derivative', 'integral', 'limit']);

export type Availability =
  { ok: true; via: 'device' | 'server' } | { ok: false; reason: 'not_eligible' | 'no_model' | 'disabled'; message: string };

export function explainAvailability(sol: Solution): Availability {
  if (!EXPLAINABLE.has(sol.kind) || !sol.result || !sol.steps.length || !sol.statement) {
    return { ok: false, reason: 'not_eligible', message: 'Pas d’explication rédigée pour ce type de problème.' };
  }
  const settings = getSettings();
  const hasModel = getModelState().status === 'ready';
  if (effectiveMode() === 'complet' && hasModel) {
    return { ok: true, via: 'device' };
  }
  if (settings.allowServer && sol.apiType) {
    return { ok: true, via: 'server' };
  }
  if (!hasModel) {
    return {
      ok: false,
      reason: 'no_model',
      message: 'Pour lire l’explication hors ligne, installe le modèle d’explication dans les réglages.',
    };
  }
  return { ok: false, reason: 'disabled', message: 'Active le mode complet ou l’envoi au serveur pour lire l’explication.' };
}

function problemOf(sol: Solution): ExplainProblem {
  return { statement_fr: sol.statement!, answer_latex: sol.result!.latex, steps: sol.steps };
}

/**
 * Valeurs nommées dans les étapes du serveur, comme problem["symbols"] dans eval/faithfulness.py :
 * « On identifie a = 2, b = -3, c = -5 » et « \Delta = b^{2} - 4ac = … = 49 ».
 */
export function stepSymbols(steps: Solution['steps']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of steps) {
    for (const m of s.text_fr.matchAll(/(?:^|[\s(,])([a-c])\s*=\s*(-?\d+(?:[.,]\d+)?)(?![\d/])/g)) {
      out[m[1]] = Number(m[2].replace(',', '.'));
    }
    const d = (s.latex ?? '').match(/^\s*\\Delta\s*=.*=\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (d) out.Delta = Number(d[1]);
  }
  return out;
}

function faithContext(sol: Solution, text: string): FaithfulnessContext {
  const sources = [sol.latex, sol.statement ?? '', sol.result?.latex ?? '', sol.result?.numeric ?? ''];
  sol.steps.forEach(s => sources.push(s.latex ?? '', s.text_fr));
  return {
    text,
    ptype: sol.apiType ?? sol.kind,
    vars: sol.variables.length ? sol.variables : ['x'],
    solutions: sol.solutions,
    answers: sol.answers,
    answerFn: sol.answerFn,
    integrand: sol.integrand,
    sources,
    noRealSolution: sol.noRealSolution,
    symbols: stepSymbols(sol.steps),
  };
}

export async function explain(sol: Solution, level: Level, onText: (t: string) => void, signal?: AbortSignal): Promise<Explanation> {
  const av = explainAvailability(sol);
  if (!av.ok) {
    throw new Error(av.message);
  }
  const t0 = Date.now();
  let text = '';
  let tokensPerSecond: number | undefined;
  if (av.via === 'device') {
    const onAbort = () => stopExplanation();
    signal?.addEventListener('abort', onAbort);
    try {
      const g = await generateExplanation(problemOf(sol), level, onText);
      text = g.text;
      tokensPerSecond = g.tokensPerSecond;
      logEvent('explain', {
        via: 'device',
        ms: Date.now() - t0,
        loadMs: g.loadMs,
        promptMs: g.promptMs,
        tokens: g.tokens,
        tokensPerSecond,
      });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  } else {
    const res = await api.explainOnServer(
      {
        problem: { latex: sol.latex, type: sol.apiType!, variables: sol.variables, route: sol.route === 'server' ? 'server' : 'local' },
        steps: sol.steps.map((s, i) => ({ index: i + 1, text_fr: s.text_fr, latex: s.latex })),
        result: { latex: sol.result!.latex, sympy: JSON.stringify(sol.answers), verified: sol.verified },
        level,
      },
      signal,
    );
    text = res.explanation.text_fr.trim();
    onText(text);
    logEvent('explain', { via: 'server', ms: Date.now() - t0 });
  }
  let report = null;
  try {
    report = await MathEngine.checkExplanation(faithContext(sol, text));
  } catch {
    report = null;
  }
  return { text, level, source: av.via, report, tokensPerSecond, at: Date.now() };
}
