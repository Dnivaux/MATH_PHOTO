/**
 * Historique des résolutions (SQLite). Une entrée garde la solution complète : elle se rouvre hors ligne,
 * explication comprise. Une entrée « pending » attend le retour du réseau (voir queue.ts).
 */
import { query, run } from '../storage/db';
import type { Solution } from '../pipeline/types';

export type HistoryStatus = 'done' | 'pending' | 'failed';

export interface HistoryItem {
  id: number;
  at: number;
  latex: string;
  status: HistoryStatus;
  solution?: Solution;
  error?: string;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function subscribeHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function parse(row: any): HistoryItem {
  let data: any = {};
  try {
    data = row.data ? JSON.parse(row.data) : {};
  } catch {
    data = {};
  }
  return { id: row.id, at: row.at, latex: row.latex, status: row.status, solution: data.solution, error: data.error };
}

export async function listHistory(limit = 50): Promise<HistoryItem[]> {
  const rows = await query('SELECT id, at, latex, status, data FROM history ORDER BY at DESC LIMIT ?', [limit]);
  return rows.map(parse);
}

export async function getHistoryItem(id: number): Promise<HistoryItem | null> {
  const rows = await query('SELECT id, at, latex, status, data FROM history WHERE id = ?', [id]);
  return rows.length ? parse(rows[0]) : null;
}

export async function addHistory(latex: string, status: HistoryStatus, solution?: Solution, error?: string): Promise<number> {
  // une même formule ne figure qu'une fois : la plus récente
  await run("DELETE FROM history WHERE latex = ? AND status != 'pending'", [latex]);
  const id = await run('INSERT INTO history (at, latex, status, data) VALUES (?, ?, ?, ?)', [
    Date.now(),
    latex,
    status,
    JSON.stringify({ solution, error }),
  ]);
  await run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY at DESC LIMIT 100)');
  emit();
  return id ?? 0;
}

export async function updateHistory(id: number, patch: { status?: HistoryStatus; solution?: Solution; error?: string }) {
  const cur = await getHistoryItem(id);
  if (!cur) {
    return;
  }
  const next = { ...cur, ...patch };
  await run('UPDATE history SET status = ?, data = ? WHERE id = ?', [
    next.status,
    JSON.stringify({ solution: next.solution, error: next.error }),
    id,
  ]);
  emit();
}

export async function clearHistory() {
  await run('DELETE FROM history');
  await run('DELETE FROM queue');
  emit();
}
