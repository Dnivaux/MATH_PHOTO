/**
 * OCR sur le téléphone : pix2tex INT8 dans le moteur embarqué. La photo ne quitte pas l'appareil.
 */
import { FractionRect, MathEngine } from '../engine/MathEngine';
import { normalizeOcrLatex } from '../engine/latexPreprocess';
import { logEvent } from '../storage/db';

export interface OcrResult {
  latex: string;
  raw: string;
  confidence: number;
  /** temps vu par l'utilisateur (lecture du fichier, prétraitement, inférence) */
  ms: number;
  inferenceMs: number;
  model: string;
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
  const out = {
    latex: normalizeOcrLatex(r.raw),
    raw: r.raw,
    confidence: r.confidence,
    ms: Date.now() - t0,
    inferenceMs: r.inferenceMs,
    model: r.model,
  };
  logEvent('ocr', {
    ms: out.ms,
    preprocessMs: r.preprocessMs,
    inferenceMs: r.inferenceMs,
    tokens: r.tokens,
    input: r.input,
    confidence: r.confidence,
    model: r.model,
  });
  return out;
}
