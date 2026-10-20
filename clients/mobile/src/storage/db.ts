/**
 * Stockage local (dossier : SQLite via op-sqlite) : réglages, historique des résolutions, file d'attente
 * des problèmes à envoyer au retour du réseau, et journal des mesures (banc embarqué, phase 2).
 */
import { open, DB } from '@op-engineering/op-sqlite';

let db: DB | null = null;
let ready: Promise<DB> | null = null;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     latex TEXT NOT NULL,
     status TEXT NOT NULL,
     data TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS history_at ON history (at DESC)',
  `CREATE TABLE IF NOT EXISTS queue (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     history_id INTEGER NOT NULL,
     at INTEGER NOT NULL,
     latex TEXT NOT NULL,
     payload TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     type TEXT NOT NULL,
     data TEXT NOT NULL
   )`,
];

export function getDb(): Promise<DB> {
  if (db) {
    return Promise.resolve(db);
  }
  if (!ready) {
    ready = (async () => {
      const d = open({ name: 'photomaths.db' });
      for (const sql of SCHEMA) {
        await d.execute(sql);
      }
      db = d;
      return d;
    })();
  }
  return ready;
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const d = await getDb();
  const r = await d.execute(sql, params);
  return (r.rows ?? []) as T[];
}

export async function run(sql: string, params: any[] = []): Promise<number | undefined> {
  const d = await getDb();
  const r = await d.execute(sql, params);
  return r.insertId;
}

// ---------------------------------------------------------------- clé / valeur

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const rows = await query<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  if (!rows.length) {
    return undefined;
  }
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
}

// ---------------------------------------------------------------- journal des mesures

export type EventType = 'ocr' | 'solve' | 'explain' | 'escalation' | 'model';

/** Mesure locale (latence, route, raison d'escalade, confiance OCR...). Rien n'est envoyé. */
export async function logEvent(type: EventType, data: Record<string, unknown>): Promise<void> {
  try {
    await run('INSERT INTO events (at, type, data) VALUES (?, ?, ?)', [Date.now(), type, JSON.stringify(data)]);
    await run('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 500)');
  } catch {
    // le journal ne doit jamais casser une résolution
  }
}

export async function recentEvents(limit = 200): Promise<{ at: number; type: EventType; data: any }[]> {
  const rows = await query<{ at: number; type: EventType; data: string }>('SELECT at, type, data FROM events ORDER BY id DESC LIMIT ?', [
    limit,
  ]);
  return rows.map(r => ({ at: r.at, type: r.type, data: JSON.parse(r.data) }));
}

export async function clearEvents(): Promise<void> {
  await run('DELETE FROM events');
}
