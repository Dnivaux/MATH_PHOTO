/**
 * Client du moteur embarqué (WebView cachée montée par MathEngineHost).
 * Les requêtes sont mises en file tant que la page n'est pas prête.
 */

export interface EngineStatus {
  page: 'loading' | 'ready';
  cortex: 'loading' | 'ready' | 'error';
  ocr: 'idle' | 'loading' | 'ready' | 'error';
  ocrLoadMs?: number;
  ocrModel?: string;
  error?: string;
}

export type ProblemKind =
  | 'arithmetic'
  | 'check'
  | 'linear'
  | 'equation'
  | 'system'
  | 'derivative'
  | 'integral'
  | 'limit'
  | 'function'
  | 'inequality'
  | 'expression'
  | 'invalid'
  | 'empty';

export type ApiProblemType = 'equation' | 'system' | 'derivative' | 'integral' | 'limit';

export interface Step {
  text_fr: string;
  latex: string | null;
}

/** Données du graphe : courbes en LaTeX, compilées par la page de solution (CortexJS) */
export interface PlotData {
  var: string;
  curves: { label: string; latex: string }[];
  points: { label: string; x: number; y: number }[];
}

export interface Analysis {
  valid: boolean;
  kind: ProblemKind;
  /** local : CortexJS sur le téléphone ; server : escalade ; none : hors périmètre */
  route?: 'local' | 'server' | 'none';
  apiType?: ApiProblemType;
  label?: string;
  variable?: string;
  statement?: string;
  result?: { latex: string; numeric: string | null } | null;
  steps?: Step[];
  solutions?: (number | null)[];
  answers?: number[];
  plot?: PlotData | null;
  reason?: string;
}

export interface EvaluateResult {
  exactLatex: string;
  numericLatex: string | null;
  value: number | null;
  isNumber: boolean;
}

export interface OcrRawResult {
  raw: string;
  confidence: number;
  tokens: number;
  input: [number, number];
  waitMs: number;
  preprocessMs: number;
  inferenceMs: number;
  model: string;
}

/** Zone à lire, en fractions de l'image (0..1) */
export interface FractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaithfulnessContext {
  text: string;
  ptype: string;
  vars?: string[];
  solutions?: Record<string, number>[];
  answers?: number[];
  answerFn?: string;
  integrand?: string;
  sources: string[];
  noRealSolution?: boolean;
  /** valeurs nommées dans les étapes (a = 2, \Delta = 49...) */
  symbols?: Record<string, number>;
}

export interface FaithfulnessReport {
  ok: number;
  fail: number;
  unparsed: number;
  failures: string[];
  finalStated: boolean;
  numbers: number;
  hallucinated: string[];
  score: number;
  accept: boolean;
}

type Injector = (js: string) => void;
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

class MathEngineClient {
  private inject: Injector | null = null;
  private pageReady = false;
  private queue: string[] = [];
  private pending = new Map<string, Pending>();
  private counter = 0;
  private listeners = new Set<(s: EngineStatus) => void>();

  status: EngineStatus = { page: 'loading', cortex: 'loading', ocr: 'idle' };

  attach(inject: Injector) {
    this.inject = inject;
  }

  /** WebView rechargée (processus de rendu tué par le système, par ex.) : les requêtes en cours échouent */
  reset() {
    this.pageReady = false;
    this.status = { page: 'loading', cortex: 'loading', ocr: 'idle' };
    this.pending.forEach(p => p.reject(new Error('Moteur redémarré')));
    this.pending.clear();
    this.emit();
  }

  handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'status') {
      const rest = { ...msg };
      delete rest.type;
      this.status = { ...this.status, ...rest };
      if (rest.page === 'ready') {
        this.pageReady = true;
        const q = this.queue;
        this.queue = [];
        q.forEach(js => this.inject?.(js));
      }
      this.emit();
      return;
    }
    if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) {
        return;
      }
      this.pending.delete(msg.id);
      if (msg.ok) {
        p.resolve(msg.data);
      } else {
        p.reject(new Error(msg.error));
      }
    }
  }

  subscribe(fn: (s: EngineStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach(l => l(this.status));
  }

  private request<T>(method: string, params: object, timeoutMs: number): Promise<T> {
    const id = `q${++this.counter}`;
    const js = `window.__engine && window.__engine.request(${JSON.stringify(id)}, ${JSON.stringify(method)}, ${JSON.stringify(params)}); true;`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Le moteur de calcul ne répond pas'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: e => {
          clearTimeout(timer);
          reject(e);
        },
      });
      if (this.pageReady && this.inject) {
        this.inject(js);
      } else {
        this.queue.push(js);
      }
    });
  }

  analyze(latex: string) {
    return this.request<Analysis>('analyze', { latex }, 20000);
  }

  evaluate(latex: string) {
    return this.request<EvaluateResult>('evaluate', { latex }, 20000);
  }

  isValid(latex: string) {
    return this.request<boolean>('isValid', { latex }, 10000);
  }

  values(list: string[]) {
    return this.request<(number | null)[]>('values', { list }, 10000);
  }

  /** Le serveur a-t-il répondu pour le problème envoyé ? */
  sameProblem(sent: string, received: string, type: string) {
    return this.request<boolean>('sameProblem', { sent, received, type }, 10000);
  }

  checkExplanation(ctx: FaithfulnessContext) {
    return this.request<FaithfulnessReport>('checkExplanation', ctx, 30000);
  }

  ocrInit() {
    return this.request<boolean>('ocrInit', {}, 120000);
  }

  /** OCR embarqué : image en base64 (JPEG/PNG), zone optionnelle en fractions de l'image */
  ocr(imageBase64: string, mime = 'image/jpeg', crop?: FractionRect) {
    return this.request<OcrRawResult>('ocr', { imageBase64, mime, crop }, 120000);
  }
}

export const MathEngine = new MathEngineClient();
