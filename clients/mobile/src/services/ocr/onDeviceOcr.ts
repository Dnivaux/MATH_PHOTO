/**
 * OCR sur le téléphone : modèle Texo exécuté dans le moteur embarqué
 * (WebView + onnxruntime-web), aucune donnée ne quitte l'appareil.
 */
import { FractionRect, MathEngine } from '../../engine/MathEngine';
import { normalizeOcrLatex } from '../../engine/latexPreprocess';

export interface OcrResult {
  latex: string;
  raw: string;
  /** temps total vu par l'utilisateur (lecture du fichier + prétraitement + inférence) */
  ms: number;
  inferenceMs: number;
  source: string;
}

/** Lit un fichier local (photo) en base64 sans module natif supplémentaire */
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
  return {
    latex: normalizeOcrLatex(r.raw),
    raw: r.raw,
    ms: Date.now() - t0,
    inferenceMs: r.inferenceMs,
    source: r.source,
  };
}
