/**
 * Dernière photo lue (zone recadrée), gardée en mémoire seulement, jamais enregistrée : si sa lecture est
 * incertaine, la résolution l'envoie au serveur, qui la relit avec TexTeller (dossier, « Escalade »).
 * Elle n'est associée qu'à la formule lue telle quelle : une formule corrigée à la main ne l'emporte pas.
 */
let last: { latex: string; image: string } | null = null;

export function rememberScan(latex: string, image: string | null | undefined): void {
  last = image ? { latex, image } : null;
}

export function scanImageFor(latex: string): string | undefined {
  return last && last.latex === latex ? last.image : undefined;
}
