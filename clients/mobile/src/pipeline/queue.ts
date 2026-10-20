/**
 * File d'attente hors ligne (dossier : « cas complexes mis en file d'attente et envoyés au retour du
 * réseau »). Un problème qui a besoin du serveur alors que le réseau manque est enregistré dans
 * l'historique (« en attente ») ; il part dès que la connexion revient, ou au prochain lancement.
 */
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { query, run } from '../storage/db';
import { addHistory, updateHistory } from '../state/history';
import { solve } from './solve';
import { SolveError } from './types';

let running = false;

export async function enqueue(latex: string, payload: { ocrConfidence?: number | null } = {}): Promise<number> {
  const historyId = await addHistory(latex, 'pending');
  await run('INSERT INTO queue (history_id, at, latex, payload) VALUES (?, ?, ?, ?)', [
    historyId,
    Date.now(),
    latex,
    JSON.stringify(payload),
  ]);
  return historyId;
}

export async function pendingCount(): Promise<number> {
  const rows = await query<{ n: number }>('SELECT COUNT(*) AS n FROM queue');
  return rows[0]?.n ?? 0;
}

export async function processQueue(): Promise<number> {
  if (running) {
    return 0;
  }
  running = true;
  let done = 0;
  try {
    const rows = await query<{ id: number; history_id: number; latex: string; payload: string; attempts: number }>(
      'SELECT id, history_id, latex, payload, attempts FROM queue ORDER BY at',
    );
    for (const r of rows) {
      const payload = JSON.parse(r.payload || '{}');
      try {
        const sol = await solve(r.latex, { ocrConfidence: payload.ocrConfidence });
        await updateHistory(r.history_id, { status: 'done', solution: sol, error: undefined });
        await run('DELETE FROM queue WHERE id = ?', [r.id]);
        done++;
      } catch (e) {
        if (e instanceof SolveError && e.code === 'offline') {
          break;
        } // toujours hors ligne : on réessaiera
        await updateHistory(r.history_id, { status: 'failed', error: (e as Error).message });
        await run('DELETE FROM queue WHERE id = ?', [r.id]);
      }
    }
  } finally {
    running = false;
  }
  return done;
}

/**
 * Relance la file au retour du réseau, au retour de l'app au premier plan, et chaque minute tant qu'elle
 * n'est pas vide (le réseau peut être là alors que le serveur était arrêté).
 */
export function startQueueWatcher(): () => void {
  const tick = () => {
    pendingCount()
      .then(n => (n > 0 ? processQueue() : 0))
      .catch(() => {});
  };
  tick();
  const net = NetInfo.addEventListener(state => {
    if (state.isConnected) {
      tick();
    }
  });
  const app = AppState.addEventListener('change', s => {
    if (s === 'active') {
      tick();
    }
  });
  const timer = setInterval(tick, 60000);
  return () => {
    net();
    app.remove();
    clearInterval(timer);
  };
}
