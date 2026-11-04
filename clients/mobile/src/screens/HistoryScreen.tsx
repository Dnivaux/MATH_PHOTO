import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PixelRatio, StatusBar, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { History as HistoryIcon, Trash2 } from 'lucide-react-native';
import { AppBar, Button, IconButton } from '../components/ui';
import { buildHistoryHtml } from '../components/history/historyHtml';
import { ASSET_BASE, FILE_ACCESS_PROPS } from '../engine/assets';
import { clearHistory, HistoryItem, listHistory, subscribeHistory } from '../state/history';
import { space, type, useTheme, webColors } from '../theme';

interface Props {
  navigation: any;
}

export const HistoryScreen: React.FC<Props> = ({ navigation }) => {
  const { c, scheme } = useTheme();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const web = useRef<React.ElementRef<typeof WebView>>(null);
  const ready = useRef(false);
  const html = useMemo(() => buildHistoryHtml(webColors(c), PixelRatio.getFontScale()), [c]);

  useEffect(() => {
    const load = () =>
      listHistory()
        .then(setItems)
        .catch(() => setItems([]));
    load();
    return subscribeHistory(load);
  }, []);

  const rows = (items ?? []).map(it => ({
    id: it.id,
    at: it.at,
    latex: it.solution?.latex ?? it.latex,
    status: it.status,
    result: it.solution?.result?.latex,
    kind: it.solution?.kindLabel,
  }));

  const push = () => {
    if (ready.current) {
      web.current?.injectJavaScript(`window.__list && window.__list.set(${JSON.stringify(rows)}); true;`);
    }
  };
  useEffect(push, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmClear = () =>
    Alert.alert('Effacer l’historique ?', 'Les résolutions enregistrées et les questions en attente seront supprimées.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Effacer', style: 'destructive', onPress: () => clearHistory() },
    ]);

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
      <AppBar
        title="Historique"
        onBack={() => navigation.goBack()}
        right={items && items.length ? <IconButton icon={Trash2} label="Effacer l’historique" onPress={confirmClear} /> : undefined}
      />
      {items && items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
            <HistoryIcon size={28} color={c.textMuted} />
          </View>
          <Text style={[type.title, { color: c.text }]}>Rien pour l’instant</Text>
          <Text style={[type.body, styles.center, { color: c.textMuted }]}>
            Tes résolutions s’enregistrent ici et se rouvrent même sans connexion.
          </Text>
          <Button label="Photographier un exercice" onPress={() => navigation.navigate('Camera')} style={styles.emptyAction} />
        </View>
      ) : (
        <WebView
          ref={web}
          {...FILE_ACCESS_PROPS}
          source={{ html, baseUrl: ASSET_BASE }}
          style={{ flex: 1, backgroundColor: c.bg }}
          onShouldStartLoadWithRequest={req => req.url.startsWith('file:') || req.url.startsWith('about:')}
          onMessage={e => {
            let m: any;
            try {
              m = JSON.parse(e.nativeEvent.data);
            } catch {
              return;
            }
            if (m.type === 'ready') {
              ready.current = true;
              push();
            } else if (m.type === 'open') {
              navigation.navigate('Solution', { historyId: m.id });
            }
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  emptyAction: { marginTop: space.lg },
  center: { textAlign: 'center' },
});
