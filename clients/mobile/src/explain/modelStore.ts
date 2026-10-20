/**
 * Modèle d'explication (GGUF) sur le téléphone. Il n'est pas dans l'APK (dossier : les modèles sont
 * téléchargés au premier lancement, hash vérifié, mis à jour depuis le registry). Sources possibles :
 *
 *  1. la gateway : GET /v1/models/android/latest?role=explainer (manifeste : url, sha256, taille) ;
 *  2. une adresse directe (réglages, développement) ;
 *  3. un fichier copié par adb dans le dossier de l'app :
 *       adb push explainer-0.6b-p20-q4_k_m.gguf /sdcard/Android/data/com.photomathclone/files/models/explainer.gguf
 */
import RNFS from 'react-native-fs';
import { getSettings } from '../config';
import { logEvent } from '../storage/db';
import { baseUrl, latestModel, ModelManifest, ServerError } from '../services/api';

export const MODEL_FILE = 'explainer.gguf';

/** Modèles livrés par l'équipe serveur (MATH_PHOTO, étape 7 : Qwen3-0.6B distillé puis quantifié Q4_K_M) */
export const KNOWN_MODELS: Record<string, { name: string; layers: number; bytes: number }> = {
  b8c535594c46d9a41586eabb23a7e8bde2aa27fea2a9cdd00ce41a97389075e3: {
    name: 'explainer-0.6b-p20 (Q4_K_M, pruné à 20 %)',
    layers: 22,
    bytes: 339236064,
  },
  '7b5772d7bcfa92e776103af72a75a4e5251143c0798e62b2ef9ec66ac2d52272': {
    name: 'explainer-0.6b (Q4_K_M)',
    layers: 28,
    bytes: 396704800,
  },
};

export interface ModelInfo {
  path: string;
  bytes: number;
  sha256?: string;
  name: string;
  verified: boolean;
}

export type ModelState =
  | { status: 'absent' }
  | { status: 'checking' }
  | { status: 'downloading'; progress: number; bytes: number; total: number }
  | { status: 'ready'; info: ModelInfo }
  | { status: 'error'; message: string };

function dir(): string {
  return `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/models`;
}

export function modelPath(): string {
  return `${dir()}/${MODEL_FILE}`;
}

let state: ModelState = { status: 'absent' };
const listeners = new Set<(s: ModelState) => void>();
let job: { jobId: number } | null = null;

function set(s: ModelState) {
  state = s;
  listeners.forEach(l => l(s));
}

export function getModelState(): ModelState {
  return state;
}

export function subscribeModel(fn: (s: ModelState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

interface Meta {
  sha256?: string;
  name?: string;
  bytes?: number;
}

async function readMeta(): Promise<Meta | null> {
  try {
    return JSON.parse(await RNFS.readFile(`${dir()}/${MODEL_FILE}.json`, 'utf8'));
  } catch {
    return null;
  }
}

async function writeMeta(m: Meta) {
  await RNFS.writeFile(`${dir()}/${MODEL_FILE}.json`, JSON.stringify(m), 'utf8');
}

/** État du modèle au démarrage (ou après un adb push) : présence, taille, empreinte connue */
export async function refreshModel(): Promise<ModelState> {
  const path = modelPath();
  try {
    // dossier créé par l'app : un fichier copié ensuite par adb y reste lisible (un dossier créé par adb
    // appartient à l'utilisateur shell et l'app ne peut pas l'ouvrir)
    if (!(await RNFS.exists(dir()))) await RNFS.mkdir(dir());
    if (!(await RNFS.exists(path))) {
      set({ status: 'absent' });
      return state;
    }
    const st = await RNFS.stat(path);
    const bytes = Number(st.size);
    const meta = await readMeta();
    let info: ModelInfo;
    if (meta?.sha256 && meta.bytes === bytes) {
      const known = KNOWN_MODELS[meta.sha256];
      info = { path, bytes, sha256: meta.sha256, name: meta.name ?? known?.name ?? 'Modèle d’explication', verified: true };
    } else {
      // fichier copié à la main : reconnu par sa taille, vérifiable à la demande
      const known = Object.entries(KNOWN_MODELS).find(([, k]) => k.bytes === bytes);
      info = { path, bytes, name: known ? known[1].name : 'Modèle d’explication (non vérifié)', verified: false };
    }
    set({ status: 'ready', info });
  } catch (e) {
    set({ status: 'error', message: (e as Error).message });
  }
  return state;
}

/** Calcule l'empreinte SHA-256 du fichier présent (quelques secondes pour 340 Mo) */
export async function verifyModel(expected?: string): Promise<boolean> {
  const path = modelPath();
  set({ status: 'checking' });
  try {
    const sha = (await RNFS.hash(path, 'sha256')).toLowerCase();
    const bytes = Number((await RNFS.stat(path)).size);
    const known = KNOWN_MODELS[sha];
    const ok = expected ? sha === expected.toLowerCase() : !!known;
    if (ok || !expected) {
      await writeMeta({ sha256: sha, name: known?.name, bytes });
    }
    await refreshModel();
    return ok;
  } catch (e) {
    set({ status: 'error', message: (e as Error).message });
    return false;
  }
}

/** Source du téléchargement : manifeste de la gateway, sinon adresse directe des réglages */
async function resolveSource(): Promise<{ url: string; sha256?: string; name?: string; bytes?: number }> {
  try {
    const m: ModelManifest = await latestModel('explainer');
    const url = /^https?:\/\//.test(m.url) ? m.url : `${baseUrl()}/${m.url.replace(/^\//, '')}`;
    return { url, sha256: m.sha256, name: `${m.name} ${m.version}`, bytes: m.bytes };
  } catch (e) {
    const direct = getSettings().modelUrl.trim();
    if (direct) {
      return { url: direct };
    }
    if (e instanceof ServerError && e.status === 404) {
      throw new Error(
        'Le serveur ne distribue pas encore le modèle. Indique une adresse directe dans les réglages développeur, ou copie le fichier avec adb.',
      );
    }
    throw e;
  }
}

export async function downloadModel(): Promise<void> {
  if (job) {
    return;
  }
  const src = await resolveSource();
  await RNFS.mkdir(dir());
  const tmp = `${modelPath()}.part`;
  set({ status: 'downloading', progress: 0, bytes: 0, total: src.bytes ?? 0 });
  const t0 = Date.now();
  const res = RNFS.downloadFile({
    fromUrl: src.url,
    toFile: tmp,
    headers: getSettings().apiKey && src.url.startsWith(baseUrl()) ? { Authorization: `Bearer ${getSettings().apiKey}` } : {},
    background: true,
    discretionary: false,
    progressInterval: 500,
    progress: p => {
      const total = p.contentLength > 0 ? p.contentLength : (src.bytes ?? 0);
      set({ status: 'downloading', progress: total ? p.bytesWritten / total : 0, bytes: p.bytesWritten, total });
    },
  });
  job = { jobId: res.jobId };
  try {
    const out = await res.promise;
    if (out.statusCode < 200 || out.statusCode >= 300) {
      throw new Error(`téléchargement refusé (HTTP ${out.statusCode})`);
    }
    const sha = (await RNFS.hash(tmp, 'sha256')).toLowerCase();
    if (src.sha256 && sha !== src.sha256.toLowerCase()) {
      throw new Error('Le fichier reçu ne correspond pas à l’empreinte annoncée : il a été supprimé.');
    }
    if (await RNFS.exists(modelPath())) {
      await RNFS.unlink(modelPath());
    }
    await RNFS.moveFile(tmp, modelPath());
    const bytes = Number((await RNFS.stat(modelPath())).size);
    await writeMeta({ sha256: sha, name: src.name ?? KNOWN_MODELS[sha]?.name, bytes });
    logEvent('model', { action: 'download', bytes, ms: Date.now() - t0, sha256: sha });
    await refreshModel();
  } catch (e) {
    await RNFS.unlink(tmp).catch(() => {});
    set({ status: 'error', message: (e as Error).message });
    throw e;
  } finally {
    job = null;
  }
}

export function cancelDownload() {
  if (job) {
    RNFS.stopDownload(job.jobId);
  }
}

export async function deleteModel(): Promise<void> {
  for (const p of [modelPath(), `${modelPath()}.json`, `${modelPath()}.part`]) {
    if (await RNFS.exists(p)) {
      await RNFS.unlink(p);
    }
  }
  set({ status: 'absent' });
}
