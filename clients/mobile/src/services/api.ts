/**
 * Client de la gateway, contrat v1 de MATH_PHOTO (serving/gateway/schema.py,
 * docs/api/openapi.json). Gateway factice : `make mock` (port 8100, jeton dev-token).
 */
import { getSettings } from '../config';

export const APP_VERSION = '0.2.0';

export class ServerError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
    this.name = 'ServerError';
  }
}

// ---- Types du contrat v1 (miroir de schema.py) ----
export type ProblemType = 'equation' | 'system' | 'derivative' | 'integral' | 'limit';
export type EscalationReason =
  | 'ocr_low_confidence'
  | 'invalid_latex'
  | 'out_of_local_scope'
  | 'local_code_failed'
  | 'device_too_weak'
  | 'user_request';
export type Level = 'college' | 'lycee' | 'superieur';

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
  client?: { platform: 'android'; app_version?: string; mode: 'complet' | 'leger' };
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
export interface ApiCode {
  language: 'python';
  source: string;
  stdout: string;
  status: 'ok' | 'error' | 'timeout' | 'rejected' | 'no_result';
  exec_ms: number;
  attempts: number;
}
export interface SolveResponse {
  api_version: string;
  request_id: string;
  status: 'ok' | 'unverified' | 'error';
  problem?: Problem | null;
  result?: ApiResult | null;
  steps: ApiStep[];
  code?: ApiCode | null;
  explanation?: { level: Level; text_fr: string; faithfulness: number } | null;
  error?: { code: string; message: string } | null;
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

// ---- Transport ----
function baseUrl(): string {
  return getSettings().serverUrl.replace(/\/+$/, '');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getSettings().apiKey;
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

async function call<T>(method: 'GET' | 'POST', path: string, body: object | undefined, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new ServerError(`serveur injoignable (${baseUrl()})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ServerError(`HTTP ${res.status} ${detail}`.trim(), res.status);
  }
  return (await res.json()) as T;
}

export function health(): Promise<Health> {
  return call<Health>('GET', '/health', undefined, 5000);
}

export function solveOnServer(req: SolveRequest): Promise<SolveResponse> {
  return call<SolveResponse>(
    'POST',
    '/v1/solve',
    { want_code: true, client: { platform: 'android', app_version: APP_VERSION, mode: 'leger' }, ...req },
    120000,
  );
}

export function explainOnServer(req: ExplainRequest): Promise<ExplainResponse> {
  return call<ExplainResponse>('POST', '/v1/explain', { level: 'lycee', ...req }, 120000);
}
