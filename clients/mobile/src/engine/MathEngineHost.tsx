/**
 * WebView invisible qui héberge le moteur (CortexJS + OCR). Montée une seule fois à la racine de l'app ;
 * le modèle OCR est préchargé dès que la page est prête.
 *
 * La page annonce son état pendant son chargement, mais ce message peut arriver côté React Native avant
 * l'événement de début de chargement : à la fin du chargement, on lui redemande donc son état complet.
 * Si le processus de rendu est tué (mémoire), la WebView est remontée : un reload() d'une page chargée
 * depuis une chaîne HTML retombe sur about:blank.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildEngineHtml } from './engineHtml';
import { MathEngine } from './MathEngine';
import { ASSET_BASE, FILE_ACCESS_PROPS } from './assets';

export const MathEngineHost: React.FC = () => {
  const ref = useRef<React.ElementRef<typeof WebView>>(null);
  const html = useMemo(() => buildEngineHtml(), []);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    MathEngine.attach(js => ref.current?.injectJavaScript(js));
  }, []);

  const restart = () => {
    MathEngine.reset();
    setGeneration(g => g + 1);
  };

  return (
    <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <WebView
        key={generation}
        ref={ref}
        source={{ html, baseUrl: ASSET_BASE }}
        {...FILE_ACCESS_PROPS}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        onLoadEnd={() => {
          ref.current?.injectJavaScript('window.__engineAnnounce && window.__engineAnnounce(); true;');
          MathEngine.ocrInit().catch(() => {});
        }}
        onShouldStartLoadWithRequest={req => req.url.startsWith('file:') || req.url.startsWith('about:')}
        onMessage={e => MathEngine.handleMessage(e.nativeEvent.data)}
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Taille non nulle : certaines versions d'Android suspendent les WebView de 0x0
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
