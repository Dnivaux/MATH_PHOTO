/**
 * Client du moteur de calcul embarqué (WebView cachée montée par MathEngineHost).
 * Les requêtes sont mises en file tant que la page n'est pas prête.
 */
import type { MathJson } from './mathjsonToSympy';

export interface EngineStatus {
  page: 'loading' | 'ready';
  cortex: 'loading' | 'ready' | 'error';
  python: 'idle' | 'loading' | 'ready' | 'restarting' | 'error';
  plot: 'idle' | 'loading' | 'ready';
  pythonMode?: 'worker' | 'main-thread';
  ocr: 'idle' | 'loading' | 'ready' | 'error';
  ocrProgress?: number;
  ocrLoadMs?: number;
  ocrSource?: string;
  pythonLoadMs?: number;
  error?: string;
}

export interface ParseResult {
  json: MathJson;
  isValid: boolean;
  latex: string;
}

export interface EvaluateResult {
  exactLatex: string;
  numericLatex: string;
  exactIsNumber: boolean;
  numericIsNumber: boolean;
  approximate: boolean;
}

/**
 * Le résultat CortexJS est-il un vrai calcul abouti ? (sinon SymPy prend le relais :
 * fonctions non évaluées comme C(5,2), Re(z), valeurs approchées…)
 */
export function isConclusive(ev: EvaluateResult): boolean {
  return (
    !ev.approximate &&
    ev.numericIsNumber &&
    !!ev.exactLatex &&
    !/\\(mathrm|operatorname|error|placeholder)|\\bot/.test(ev.exactLatex)
  );
}

export interface OcrRawResult {
  raw: string;
  waitMs: number;
  preprocessMs: number;
  inferenceMs: number;
  source: string;
}

/** Zone à lire, en fractions de l'image (0..1) */
export interface FractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Données du graphe interactif (courbes en JavaScript, recalculées au zoom) */
export interface PlotData {
  var: string;
  range?: [number, number];
  curves: { label: string; js: string; latex: string }[];
  points: { label: string; x: number; y: number }[];
}

export interface PythonRunResult {
  ok: boolean;
  steps: { label: string; latex: string }[];
  result_latex: string | null;
  numeric_latex: string | null;
  plot: PlotData | null;
  error: string | null;
  traceback?: string;
  plot_error?: string;
  ms: number;
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
  private pythonWaiters: (() => void)[] = [];

  status: EngineStatus = { page: 'loading', cortex: 'loading', python: 'idle', plot: 'idle', ocr: 'idle' };

  /** Appelé par MathEngineHost */
  attach(inject: Injector) {
    this.inject = inject;
  }

  /** Appelé par MathEngineHost quand la WebView est rechargée */
  reset() {
    this.pageReady = false;
    this.status = { page: 'loading', cortex: 'loading', python: 'idle', plot: 'idle', ocr: 'idle' };
    this.emit();
  }

  /** Message brut reçu de la WebView */
  handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'status') {
      const { type, ...rest } = msg;
      this.status = { ...this.status, ...rest };
      if (rest.page === 'ready') {
        this.pageReady = true;
        const q = this.queue;
        this.queue = [];
        q.forEach(js => this.inject?.(js));
      }
      if (rest.python === 'ready') {
        this.pythonWaiters.forEach(w => w());
        this.pythonWaiters = [];
      }
      this.emit();
      return;
    }
    if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error));
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

  private request<T>(method: string, params: object, timeoutMs = 90000): Promise<T> {
    const id = `q${++this.counter}`;
    const js = `window.__engine && window.__engine.request(${JSON.stringify(id)}, ${JSON.stringify(method)}, ${JSON.stringify(params)}); true;`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Moteur : pas de réponse à ${method}`));
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
      if (this.pageReady && this.inject) this.inject(js);
      else this.queue.push(js);
    });
  }

  parse(latex: string) {
    return this.request<ParseResult>('parse', { latex }, 20000);
  }

  evaluate(latex: string) {
    return this.request<EvaluateResult>('evaluate', { latex }, 20000);
  }

  /** Charge le modèle OCR (téléchargé une fois, puis en cache) */
  ocrInit() {
    return this.request<boolean>('ocrInit', {}, 600000);
  }

  /** OCR embarqué : image en base64 (JPEG/PNG), zone optionnelle en fractions */
  ocr(imageBase64: string, mime = 'image/jpeg', crop?: FractionRect) {
    return this.request<OcrRawResult>('ocr', { imageBase64, mime, crop }, 600000);
  }

  /** Attend que Pyodide + SymPy soient chargés (préchargés au démarrage) */
  waitForPython(timeoutMs = 120000): Promise<void> {
    if (this.status.python === 'ready') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Pyodide ne s\'est pas chargé (connexion internet ?)')), timeoutMs);
      this.pythonWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  async runPython(code: string, opts: { plot?: boolean; timeoutMs?: number } = {}) {
    await this.waitForPython();
    const timeoutMs = opts.timeoutMs ?? (opts.plot && this.status.plot !== 'ready' ? 90000 : 20000);
    return this.request<PythonRunResult>('runPython', { code, plot: !!opts.plot, timeoutMs }, timeoutMs + 5000);
  }
}

export const MathEngine = new MathEngineClient();
