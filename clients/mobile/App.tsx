import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { MathEngineHost } from './src/engine/MathEngineHost';
import { SnackbarHost } from './src/components/ui/Snackbar';
import { loadSettings } from './src/config';
import { loadDeviceInfo } from './src/device';
import { refreshModel } from './src/explain/modelStore';
import { startQueueWatcher } from './src/pipeline/queue';
import { useTheme } from './src/theme';

export default function App() {
  const { c } = useTheme();

  useEffect(() => {
    let stop: (() => void) | undefined;
    (async () => {
      await Promise.all([loadSettings(), loadDeviceInfo()]);
      refreshModel().catch(() => {});
      stop = startQueueWatcher();
    })();
    return () => stop?.();
  }, []);

  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: c.bg }]}>
      <SafeAreaProvider>
        {/* Moteur embarqué (CortexJS + OCR), préchargé dès le démarrage */}
        <MathEngineHost />
        <RootNavigator />
        <SnackbarHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
