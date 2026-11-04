/**
 * OCR sur le téléphone : deux lecteurs pix2text-mfr (v1 et 1.5) INT8 dans le moteur embarqué, qui votent. Quand
 * leurs lectures concordent, la formule est juste (267 accords sur 300 images au banc OCR, tous justes). Sinon
 * la zone recadrée est relue par le serveur, ou l'utilisateur choisit. La photo ne quitte l'appareil que dans ce cas.
 */
import { FractionRect, MathEngine } from '../engine/MathEngine';
import { normalizeOcrLatex, ocrKey } from '../engine/latexPreprocess';
import { logEvent } from '../storage/db';

export interface OcrResult {
  latex: string;
  raw: string;
  confidence: number;
  /** temps vu par l'utilisateur (lecture du fichier, prétraitement, inférence) */
  ms: number;
  inferenceMs: number;
  model: string;
  /** zone lue (JPEG base64), gardée en mémoire seulement */
  image: string | null;
  /** lecture du second lecteur quand elle diffère de la première (normalisée), sinon null */
  alt: string | null;
  /** les deux lecteurs lisent la même formule (à l'écriture près) */
  agree: boolean;
}

/** Lit un fichier local (photo) en base64, sans module natif supplémentaire */
export async function fileToBase64(path: string): Promise<string> {
  const uri = /^(file|content):\/\//.test(path) ? path : `file://${path}`;
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Lecture de la photo impossible'));
    reader.readAsDataURL(blob);
  });
}

export async function recognizeOnDevice(base64: string, mime = 'image/jpeg', crop?: FractionRect): Promise<OcrResult> {
  const t0 = Date.now();
  const r = await MathEngine.ocr(base64, mime, crop);
  const latex = normalizeOcrLatex(r.raw);
  const second = r.readings?.[1] ? normalizeOcrLatex(r.readings[1].raw) : null;
  const agree = second === null || ocrKey(second) === ocrKey(latex);
  const out = {
    latex,
    alt: agree ? null : second,
    agree,
    raw: r.raw,
    confidence: r.confidence,
    ms: Date.now() - t0,
    inferenceMs: r.inferenceMs,
    model: r.model,
    image: r.image ?? null,
  };
  logEvent('ocr', {
    ms: out.ms,
    preprocessMs: r.preprocessMs,
    inferenceMs: r.inferenceMs,
    tokens: r.tokens,
    input: r.input,
    confidence: r.confidence,
    model: r.model,
    agree,
    readers: r.readings?.map(x => ({ model: x.model, ms: x.ms, tokens: x.tokens, confidence: x.confidence })),
  });
  return out;
}
