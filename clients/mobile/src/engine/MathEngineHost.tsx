/**
 * WebView invisible qui héberge CortexJS + Pyodide. Montée une seule fois à la
 * racine de l'app pour que Pyodide soit préchargé dès le démarrage.
 */
import React, { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildEngineHtml } from './engineHtml';
import { MathEngine } from './MathEngine';
import { ASSET_BASE, FILE_ACCESS_PROPS } from './assets';

export const MathEngineHost: React.FC = () => {
  const ref = useRef<React.ElementRef<typeof WebView>>(null);
  const html = useMemo(() => buildEngineHtml(), []);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html, baseUrl: ASSET_BASE }}
        {...FILE_ACCESS_PROPS}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        onLoadStart={() => {
          MathEngine.reset();
          MathEngine.attach(js => ref.current?.injectJavaScript(js));
        }}
        onLoadEnd={() => {
          // préchargement du modèle OCR (lu dans l'APK) dès le démarrage
          MathEngine.ocrInit().catch(() => {});
        }}
        onMessage={e => MathEngine.handleMessage(e.nativeEvent.data)}
        onContentProcessDidTerminate={() => ref.current?.reload()}
        onRenderProcessGone={() => ref.current?.reload()}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Taille non nulle : certaines versions d'Android suspendent les WebView de 0x0
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
