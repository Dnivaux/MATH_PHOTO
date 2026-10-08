/**
 * Réglages de l'app, modifiables depuis l'écran Réglages (gardés en mémoire
 * pour l'instant : à persister avec SQLite plus tard, cf. dossier).
 */
export interface AppSettings {
  /** URL de la gateway (MATH_PHOTO : `make mock` écoute sur 8100). 10.0.2.2 = le PC vu depuis l'émulateur */
  serverUrl: string;
  /** Jeton Bearer de la gateway (factice : dev-token) */
  apiKey: string;
  /** Autoriser l'escalade vers le serveur (cas hors périmètre local, explication) */
  allowServer: boolean;
  /** Seuil de confiance OCR sous lequel on prévient l'utilisateur (quand le modèle fournira un score) */
  ocrMinConfidence: number;
}

let settings: AppSettings = {
  serverUrl: 'http://10.0.2.2:8100',
  apiKey: 'dev-token',
  allowServer: true,
  ocrMinConfidence: 0.5,
};

const listeners = new Set<(s: AppSettings) => void>();

export function getSettings(): AppSettings {
  return settings;
}

export function updateSettings(patch: Partial<AppSettings>) {
  settings = { ...settings, ...patch };
  listeners.forEach(l => l(settings));
}

export function subscribeSettings(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
