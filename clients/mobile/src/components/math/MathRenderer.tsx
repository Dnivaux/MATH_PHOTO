import React, { useMemo, useState } from 'react';
import { PixelRatio, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { ASSET_BASE, FILE_ACCESS_PROPS } from '../../engine/assets';
import { useTheme } from '../../theme';
import { buildMathHtml } from './mathHtml';

interface MathRendererProps {
  /** LaTeX (mode « display ») ou texte avec $...$ (mode « text ») */
  math: string;
  mode?: 'display' | 'text';
  color?: string;
  /** taille de base ; suit la taille de police choisie dans Android */
  fontSize?: number;
  align?: 'center' | 'left';
  minHeight?: number;
  /** libellé lu par TalkBack (la formule en clair, sinon le LaTeX) */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Rendu KaTeX dans une WebView, hauteur ajustée au contenu. Le LaTeX est passé en JSON. */
export const MathRenderer: React.FC<MathRendererProps> = ({
  math,
  mode = 'display',
  color,
  fontSize = 20,
  align = 'center',
  minHeight = 40,
  accessibilityLabel,
  style,
}) => {
  const { c } = useTheme();
  const [height, setHeight] = useState(minHeight);
  const scaled = Math.round(fontSize * PixelRatio.getFontScale());
  const fg = color ?? c.text;
  const html = useMemo(() => buildMathHtml({ math, mode, color: fg, fontSize: scaled, align }), [math, mode, fg, scaled, align]);

  return (
    <View
      style={[styles.container, { height: Math.max(height, minHeight) }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `Formule : ${math}`}>
      <WebView
        {...FILE_ACCESS_PROPS}
        source={{ html, baseUrl: ASSET_BASE }}
        style={styles.webView}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        importantForAccessibility="no-hide-descendants"
        onShouldStartLoadWithRequest={req => req.url.startsWith('file:') || req.url.startsWith('about:')}
        onMessage={e => {
          const h = Number(e.nativeEvent.data);
          if (h > 0 && Math.abs(h - height) > 1) {
            setHeight(h + 4);
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: 'transparent', overflow: 'hidden' },
  webView: { backgroundColor: 'transparent' },
});
