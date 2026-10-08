/** Historique des calculs de la session (à persister en SQLite plus tard, cf. dossier) */
export interface HistoryItem {
  latex: string;
  result?: string;
  at: number;
}

let items: HistoryItem[] = [];
const listeners = new Set<(h: HistoryItem[]) => void>();

export function getHistory(): HistoryItem[] {
  return items;
}

export function pushHistory(latex: string, result?: string) {
  if (!latex.trim()) return;
  items = [{ latex, result, at: Date.now() }, ...items.filter(i => i.latex !== latex)].slice(0, 30);
  listeners.forEach(l => l(items));
}

export function subscribeHistory(fn: (h: HistoryItem[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
