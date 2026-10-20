/**
 * LLM de raisonnement sur le téléphone (dossier : Qwen3-0.6B distillé, GGUF Q4_K_M, llama.cpp via llama.rn).
 *
 * Le modèle reçoit exactement le prompt de l'entraînement (prompt.ts) et ne rédige que l'explication
 * d'étapes déjà calculées ; chaque égalité est ensuite revérifiée par le moteur (MathEngine.checkExplanation).
 * Le contexte est chargé à la première explication, gardé tant que l'app est au premier plan, et libéré
 * une minute après son passage en arrière-plan (la RAM revient au système).
 */
import { AppState } from 'react-native';
import { initLlama, LlamaContext } from 'llama.rn';
import { modelPath } from './modelStore';
import { ExplainProblem, explainMessages, Level, qwen3Prompt, STOP_WORDS } from './prompt';

/** Réglages d'inférence (dossier, « Leviers si la RAM manque » : contexte court, cache KV maîtrisé) */
const CONTEXT = { n_ctx: 2048, n_batch: 256, n_threads: 4, use_mlock: false, use_mmap: true, n_gpu_layers: 0 };
/** Mêmes réglages que la gateway en mode léger (serving/gateway/app.py) */
const SAMPLING = { n_predict: 800, temperature: 0.3, top_p: 0.95, top_k: 20, penalty_repeat: 1.05 };

let ctx: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

AppState.addEventListener('change', s => {
  if (s === 'active') {
    if (releaseTimer) {
      clearTimeout(releaseTimer);
    }
    releaseTimer = null;
  } else if (ctx && !busy) {
    releaseTimer = setTimeout(() => releaseExplainer(), 60000);
  }
});

export interface LoadInfo {
  ms: number;
}

async function context(): Promise<LlamaContext> {
  if (ctx) {
    return ctx;
  }
  if (!loading) {
    loading = initLlama({ model: `file://${modelPath()}`, ...CONTEXT })
      .then(c => {
        ctx = c;
        return c;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export interface GenerationResult {
  text: string;
  tokens: number;
  tokensPerSecond: number;
  promptMs: number;
  loadMs: number;
  stopped: boolean;
}

/** Rédige l'explication ; `onText` reçoit le texte complet à chaque jeton (affichage en continu) */
export async function generateExplanation(
  problem: ExplainProblem,
  level: Level,
  onText: (text: string) => void,
): Promise<GenerationResult> {
  const t0 = Date.now();
  const c = await context();
  const loadMs = Date.now() - t0;
  busy = true;
  let text = '';
  let stopped = false;
  try {
    const res = await c.completion(
      {
        prompt: qwen3Prompt(explainMessages(problem, level)),
        stop: STOP_WORDS,
        reasoning_format: 'none',
        ...SAMPLING,
      },
      data => {
        text += data.token;
        onText(text);
      },
    );
    stopped = res.interrupted;
    const out = (res.text ?? text).trim();
    return {
      text: out,
      tokens: res.timings?.predicted_n ?? 0,
      tokensPerSecond: Math.round((res.timings?.predicted_per_second ?? 0) * 10) / 10,
      promptMs: Math.round(res.timings?.prompt_ms ?? 0),
      loadMs,
      stopped,
    };
  } finally {
    busy = false;
  }
}

export async function stopExplanation(): Promise<void> {
  if (ctx) {
    await ctx.stopCompletion().catch(() => {});
  }
}

export async function releaseExplainer(): Promise<void> {
  const c = ctx;
  ctx = null;
  if (c) {
    await c.release().catch(() => {});
  }
}
