import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { PlotData } from '../../engine/MathEngine';
import { buildGraphHtml } from './graphHtml';

interface Props {
  plot: PlotData;
  height?: number;
  /** le parent (ScrollView) doit cesser de défiler pendant un geste sur le graphe */
  onGesture?: (active: boolean) => void;
}

/** Graphe interactif : déplacer, pincer pour zoomer, toucher pour lire une valeur */
export const GraphView: React.FC<Props> = ({ plot, height = 300, onGesture }) => {
  const html = useMemo(() => buildGraphHtml(plot), [plot]);
  return (
    <View
      style={[styles.box, { height }]}
      onTouchStart={() => onGesture?.(true)}
      onTouchEnd={() => onGesture?.(false)}
      onTouchCancel={() => onGesture?.(false)}
    >
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        scrollEnabled={false}
        nestedScrollEnabled
        style={styles.web}
        onMessage={e => {
          if (e.nativeEvent.data === 'touch-start') onGesture?.(true);
          if (e.nativeEvent.data === 'touch-end') onGesture?.(false);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  box: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' },
  web: { backgroundColor: '#fff' },
});
