/**
 * Réglages de l'app, enregistrés en SQLite (table kv) et chargés au démarrage.
 */
import { kvGet, kvSet } from './storage/db';
import type { Level } from './explain/prompt';

/** Mode d'installation (dossier) : complet = explication rédigée sur le téléphone, léger = par le serveur */
export type InstallMode = 'auto' | 'complet' | 'leger';

export interface AppSettings {
  /** Gateway MATH_PHOTO (`make mock` écoute sur 8100). 10.0.2.2 = le PC vu depuis l'émulateur */
  serverUrl: string;
  /** Jeton Bearer de la gateway (factice : dev-token) */
  apiKey: string;
  /** Autoriser l'envoi au serveur (problèmes hors du périmètre local, explication en mode léger) */
  allowServer: boolean;
  mode: InstallMode;
  level: Level;
  /** Confiance OCR sous laquelle la formule est vérifiée par le serveur (ocr_low_confidence) */
  ocrMinConfidence: number;
  /** Adresse directe du modèle d'explication (développement), si la gateway ne le distribue pas */
  modelUrl: string;
  /** Outils de développement visibles (mesures, réglages du serveur) */
  devMode: boolean;
  /** Consigne de cadrage déjà montrée */
  cameraTipSeen: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: 'http://10.0.2.2:8100',
  apiKey: 'dev-token',
  allowServer: true,
  mode: 'auto',
  level: 'lycee',
  ocrMinConfidence: 0.9,
  modelUrl: '',
  devMode: false,
  cameraTipSeen: false,
};

let settings: AppSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<(s: AppSettings) => void>();

export async function loadSettings(): Promise<AppSettings> {
  try {
    const saved = await kvGet<Partial<AppSettings>>('settings');
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    // base indisponible : valeurs par défaut
  }
  listeners.forEach(l => l(settings));
  return settings;
}

export function getSettings(): AppSettings {
  return settings;
}

export function updateSettings(patch: Partial<AppSettings>) {
  settings = { ...settings, ...patch };
  listeners.forEach(l => l(settings));
  kvSet('settings', settings).catch(() => {});
}

export function subscribeSettings(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
