import { useColorScheme } from 'react-native';
import { dark, light, Palette } from './tokens';

export * from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  c: Palette;
}

/** Thème courant : suit l'apparence du téléphone (clair / sombre) */
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, c: scheme === 'dark' ? dark : light };
}

/** Couleurs passées aux pages WebView (KaTeX, MathLive, page de solution, graphe) */
export function webColors(c: Palette) {
  return {
    bg: c.bg,
    surface: c.surface,
    surfaceAlt: c.surfaceAlt,
    line: c.line,
    lineStrong: c.lineStrong,
    text: c.text,
    textMuted: c.textMuted,
    textFaint: c.textFaint,
    primary: c.primary,
    primaryContainer: c.primaryContainer,
    onPrimaryContainer: c.onPrimaryContainer,
    success: c.success,
    successContainer: c.successContainer,
    warning: c.warning,
    warningContainer: c.warningContainer,
    error: c.error,
    errorContainer: c.errorContainer,
  };
}

export type WebColors = ReturnType<typeof webColors>;
