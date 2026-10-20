/**
 * Client de la gateway, contrat v1 de MATH_PHOTO (serving/gateway/schema.py, docs/api/openapi.json).
 * Gateway factice : `make mock` (port 8100, jeton dev-token).
 */
import { getSettings } from '../config';
import { effectiveMode } from '../device';
import type { Level } from '../explain/prompt';

export const APP_VERSION = '0.3.0';

export type ServerErrorKind = 'network' | 'timeout' | 'auth' | 'rate_limit' | 'http';

export class ServerError extends Error {
  constructor(
    message: string,
    public kind: ServerErrorKind,
    public status?: number,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

// ---- Types du contrat v1 (miroir de schema.py) ----
export type ProblemType = 'equation' | 'system' | 'derivative' | 'integral' | 'limit';
export type EscalationReason =
  'ocr_low_confidence' | 'invalid_latex' | 'out_of_local_scope' | 'local_code_failed' | 'device_too_weak' | 'user_request';
export type ErrorCode =
  'parse_error' | 'unsupported_type' | 'image_not_supported' | 'code_failed' | 'timeout' | 'answer_mismatch' | 'llm_unavailable';

export interface Escalation {
  reason: EscalationReason;
  detail?: string | null;
  ocr_confidence?: number | null;
}

export interface SolveRequest {
  latex?: string;
  image_base64?: string;
  type_hint?: ProblemType;
  want_code?: boolean;
  escalation?: Escalation;
}

export interface Problem {
  latex: string;
  type: ProblemType;
  variables: string[];
  route: 'local' | 'server';
}
export interface ApiResult {
  latex: string;
  sympy: string;
  verified: boolean;
}
export interface ApiStep {
  index: number;
  text_fr: string;
  latex?: string | null;
}
export interface SolveResponse {
  api_version: string;
  request_id: string;
  status: 'ok' | 'unverified' | 'error';
  problem?: Problem | null;
  result?: ApiResult | null;
  steps: ApiStep[];
  explanation?: { level: Level; text_fr: string; faithfulness: number } | null;
  escalation?: Escalation | null;
  error?: { code: ErrorCode; message: string } | null;
  models: { code_model?: string | null; code_model_version?: string | null; explain_model?: string | null };
  timings: { ocr_ms: number; parse_ms: number; llm_ms: number; sandbox_ms: number; total_ms: number };
}
export interface ExplainRequest {
  problem: Problem;
  steps: ApiStep[];
  result: ApiResult;
  level?: Level;
}
export interface ExplainResponse {
  api_version: string;
  request_id: string;
  explanation: { level: Level; text_fr: string; faithfulness: number };
}
export interface Health {
  status: 'ok' | 'degraded';
  api_version: string;
  mock: boolean;
  llm?: boolean | null;
}

/**
 * Modèle distribué par la gateway (dossier, phase 6 : GET /v1/models/{client}/latest, hash vérifié).
 * Endpoint pas encore présent dans la gateway : l'app accepte aussi une adresse directe (réglages).
 */
export interface ModelManifest {
  role: 'explainer';
  name: string;
  version: string;
  url: string;
  sha256: string;
  bytes: number;
}

// ---- Transport ----
export function baseUrl(): string {
  return getSettings().serverUrl.replace(/\/+$/, '');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getSettings().apiKey;
  if (key) {
    h.Authorization = `Bearer ${key}`;
  }
  return h;
}

async function call<T>(method: 'GET' | 'POST', path: string, body: object | undefined, ms: number, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (signal?.aborted) {
      throw new ServerError('Demande annulée', 'network');
    }
    if (timedOut) {
      throw new ServerError('Le serveur met trop de temps à répondre.', 'timeout');
    }
    throw new ServerError('Pas de connexion au serveur.', 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : '';
    } catch {
      detail = '';
    }
    if (res.status === 401 || res.status === 403) {
      throw new ServerError('Le serveur a refusé le jeton d’accès.', 'auth', res.status);
    }
    if (res.status === 429) {
      throw new ServerError('Trop de demandes : réessaie dans un instant.', 'rate_limit', res.status);
    }
    throw new ServerError(`Le serveur a répondu par une erreur (${res.status}${detail ? ` : ${detail}` : ''}).`, 'http', res.status);
  }
  return (await res.json()) as T;
}

export function health(): Promise<Health> {
  return call<Health>('GET', '/health', undefined, 5000);
}

export function solveOnServer(req: SolveRequest, signal?: AbortSignal): Promise<SolveResponse> {
  return call<SolveResponse>(
    'POST',
    '/v1/solve',
    {
      want_code: false, // dossier : pas de code Python affiché sur le téléphone
      client: { platform: 'android', app_version: APP_VERSION, mode: effectiveMode() },
      ...req,
    },
    90000,
    signal,
  );
}

export function explainOnServer(req: ExplainRequest, signal?: AbortSignal): Promise<ExplainResponse> {
  return call<ExplainResponse>('POST', '/v1/explain', req, 90000, signal);
}

export function latestModel(role: 'explainer' = 'explainer'): Promise<ModelManifest> {
  return call<ModelManifest>('GET', `/v1/models/android/latest?role=${role}`, undefined, 10000);
}

/** Message affiché pour un code d'erreur du serveur */
export function errorMessage(code?: ErrorCode | string, fallback?: string): string {
  switch (code) {
    case 'parse_error':
      return 'Le serveur n’a pas compris la formule. Vérifie-la et corrige-la si besoin.';
    case 'unsupported_type':
      return 'Ce type de problème n’est pas encore pris en charge.';
    case 'image_not_supported':
      return 'Le serveur ne lit pas encore les photos : envoie la formule en LaTeX.';
    case 'code_failed':
    case 'timeout':
      return 'Le serveur n’a pas réussi à résoudre ce problème.';
    case 'llm_unavailable':
      return 'Le serveur de calcul est indisponible pour le moment.';
    default:
      return fallback ?? 'Le serveur n’a pas pu résoudre ce problème.';
  }
}
