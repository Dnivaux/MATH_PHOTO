/**
 * Système de design de l'app (tokens).
 *
 * Direction : la copie d'un élève. L'encre bleue du stylo sert à l'action et au résultat, le rouge du
 * correcteur est réservé aux erreurs, le vert au « vérifié ». Le thème clair est la copie Seyès : papier blanc
 * froid, filets bleu-gris ; le sombre, la lampe de bureau le soir. Les deux suivent le réglage du téléphone ;
 * la caméra reste toujours sombre.
 *
 * Contrastes vérifiés (WCAG AA) : text / textMuted / textFaint >= 4,5:1 sur bg et surface, dans les deux thèmes.
 */

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceSunken: string;
  line: string;
  lineStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  success: string;
  successContainer: string;
  warning: string;
  warningContainer: string;
  error: string;
  errorContainer: string;
  scrim: string;
  /** clavier de la calculatrice : trois familles nettement distinctes */
  keyDigit: string;
  keyFn: string;
  keyOp: string;
  onKeyOp: string;
}

export const light: Palette = {
  bg: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEEF5',
  surfaceSunken: '#E3E6F0',
  line: '#D9DCE8',
  lineStrong: '#B4BAD0',
  text: '#1A1C26',
  textMuted: '#525669',
  textFaint: '#5C6074',
  primary: '#1F47C7',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DEE5FB',
  onPrimaryContainer: '#122A73',
  success: '#1B7348',
  successContainer: '#DCF0E3',
  warning: '#8F5300',
  warningContainer: '#FBEACB',
  error: '#BD241A',
  errorContainer: '#FBE0DC',
  scrim: 'rgba(16, 18, 24, 0.45)',
  keyDigit: '#FFFFFF',
  keyFn: '#E8EAF2',
  keyOp: '#DEE5FB',
  onKeyOp: '#122A73',
};

export const dark: Palette = {
  bg: '#0F1116',
  surface: '#171A21',
  surfaceAlt: '#20242D',
  surfaceSunken: '#0B0D11',
  line: '#2A2F3A',
  lineStrong: '#3C4352',
  text: '#ECEEF3',
  textMuted: '#A7ACB9',
  textFaint: '#8D93A3',
  primary: '#8DAAFF',
  onPrimary: '#0B1640',
  primaryContainer: '#1D2C60',
  onPrimaryContainer: '#DAE3FF',
  success: '#62D49C',
  successContainer: '#12301F',
  warning: '#F2B451',
  warningContainer: '#3A2A0E',
  error: '#FF8A80',
  errorContainer: '#3D1512',
  scrim: 'rgba(0, 0, 0, 0.6)',
  keyDigit: '#272C37',
  keyFn: '#1B1F27',
  keyOp: '#1D2C60',
  onKeyOp: '#DAE3FF',
};

/** Habillage de la caméra : toujours sombre, quelle que soit l'apparence du téléphone */
export const camera = {
  chrome: 'rgba(10, 11, 14, 0.62)',
  chromeStrong: 'rgba(10, 11, 14, 0.82)',
  mask: 'rgba(0, 0, 0, 0.55)',
  frame: '#FFFFFF',
  text: '#FFFFFF',
  textMuted: 'rgba(255, 255, 255, 0.78)',
  shutter: '#FFFFFF',
  busy: '#8DAAFF',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 20, full: 999 } as const;

/** Échelle typographique (sp : suit la taille de police du téléphone) */
export const type = {
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  titleSm: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodySm: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
};

/** Cible tactile minimale (Material : 48 dp) */
export const TOUCH = 48;
