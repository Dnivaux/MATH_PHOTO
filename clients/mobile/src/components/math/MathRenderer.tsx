import React, { useMemo, useState } from 'react';
import { StyleSheet, View, StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { ASSET_BASE, FILE_ACCESS_PROPS } from '../../engine/assets';
import { buildMathHtml } from './mathHtml';

interface MathRendererProps {
  /** LaTeX (mode "display") ou texte avec $...$ (mode "text") */
  math: string;
  mode?: 'display' | 'text';
  color?: string;
  fontSize?: number;
  /** Hauteur minimale ; la hauteur réelle s'adapte au contenu */
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Rendu KaTeX dans une WebView, hauteur ajustée au contenu.
 * Le LaTeX est passé en JSON (jamais concaténé dans le script).
 */
export const MathRenderer: React.FC<MathRendererProps> = ({
  math,
  mode = 'display',
  color = '#FFFFFF',
  fontSize = 20,
  minHeight = 40,
  style,
}) => {
  const [height, setHeight] = useState(minHeight);

  const html = useMemo(() => buildMathHtml(math, mode, color, fontSize), [math, mode, color, fontSize]);

  return (
    <View style={[styles.container, { height: Math.max(height, minHeight) }, style]}>
      <WebView
        {...FILE_ACCESS_PROPS}
        source={{ html, baseUrl: ASSET_BASE }}
        style={styles.webView}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        onMessage={e => {
          const h = Number(e.nativeEvent.data);
          if (h > 0 && Math.abs(h - height) > 1) setHeight(h + 4);
        }}
      />
    </View>
  );
};

export default MathRenderer;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  webView: {
    backgroundColor: 'transparent',
  },
});
