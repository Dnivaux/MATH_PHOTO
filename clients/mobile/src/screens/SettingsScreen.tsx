import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getSettings, updateSettings } from '../config';
import { health, Health } from '../services/api';
import { EngineStatus, MathEngine } from '../engine/MathEngine';
import { CORTEX_VERSION, PYODIDE_VERSION } from '../engine/engineHtml';

/** Réglages + écran de debug (état du moteur embarqué, test du serveur) */
export const SettingsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [s, setS] = useState(getSettings());
  const [engine, setEngine] = useState<EngineStatus>(MathEngine.status);
  const [check, setCheck] = useState<{ loading?: boolean; ok?: Health; error?: string }>({});

  useEffect(() => MathEngine.subscribe(st => setEngine({ ...st })), []);

  const patch = (p: Partial<typeof s>) => {
    updateSettings(p);
    setS(getSettings());
  };

  const testServer = async () => {
    setCheck({ loading: true });
    try {
      setCheck({ ok: await health() });
    } catch (e: any) {
      setCheck({ error: e?.message ?? String(e) });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Réglages</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Serveur (escalade)</Text>
        <Text style={styles.label}>URL de la gateway</Text>
        <TextInput
          style={styles.input}
          value={s.serverUrl}
          onChangeText={v => patch({ serverUrl: v.trim() })}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.help}>
          Gateway MATH_PHOTO (`make mock` : port 8100, jeton dev-token). Émulateur : http://10.0.2.2:8100 ·
          Téléphone : http://IP-DU-PC:8100 (même Wi-Fi) ou `adb reverse tcp:8100 tcp:8100` puis http://localhost:8100
        </Text>
        <Text style={styles.label}>Jeton d'API (Bearer)</Text>
        <TextInput
          style={styles.input}
          value={s.apiKey}
          onChangeText={v => patch({ apiKey: v.trim() })}
          autoCapitalize="none"
          secureTextEntry
        />
        <Row label="Autoriser l'escalade serveur" value={s.allowServer} onChange={v => patch({ allowServer: v })} />
        <TouchableOpacity style={styles.btn} onPress={testServer}>
          <Text style={styles.btnText}>{check.loading ? 'Test…' : 'Tester la connexion'}</Text>
        </TouchableOpacity>
        {check.ok && (
          <Text style={styles.ok}>
            {check.ok.status === 'ok' ? 'OK' : 'Dégradé'} · API v{check.ok.api_version}
            {check.ok.mock ? ' · gateway factice' : ''}
            {check.ok.llm != null ? ` · LLM ${check.ok.llm ? 'disponible' : 'indisponible'}` : ''}
          </Text>
        )}
        {check.error && <Text style={styles.err}>{check.error}</Text>}

        <Text style={styles.section}>Moteur embarqué</Text>
        <Info
          k="OCR Texo (sur le téléphone)"
          v={`${engine.ocr}${engine.ocr === 'loading' && engine.ocrProgress ? ` ${engine.ocrProgress} %` : ''}${
            engine.ocrLoadMs ? ` · ${engine.ocrLoadMs} ms` : ''
          }${engine.ocrSource ? ` · ${engine.ocrSource === 'apk' ? 'APK' : 'téléchargé'}` : ''}`}
        />
        <Info k="Page moteur" v={engine.page} />
        <Info k={`CortexJS ${CORTEX_VERSION}`} v={engine.cortex} />
        <Info
          k={`Pyodide ${PYODIDE_VERSION} + SymPy`}
          v={`${engine.python}${engine.pythonLoadMs ? ` · ${engine.pythonLoadMs} ms` : ''}${
            engine.pythonMode ? ` · ${engine.pythonMode}` : ''
          }`}
        />

        {engine.error && <Text style={styles.err}>{engine.error}</Text>}
        <Text style={styles.help}>
          Tout est embarqué dans l'APK (modèle OCR, CortexJS, Pyodide, KaTeX, MathLive) : fonctionne hors ligne.
          Si un fichier manque (npm run engine-assets non lancé), il est téléchargé depuis le CDN.
        </Text>
      </ScrollView>
    </View>
  );
};

const Row: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void; help?: string }> = ({
  label,
  value,
  onChange,
  help,
}) => (
  <View style={{ marginTop: 14 }}>
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
    {help && <Text style={styles.help}>{help}</Text>}
  </View>
);

const Info: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{k}</Text>
    <Text style={styles.value}>{v}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0C' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  back: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  title: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 48 },
  section: { color: '#FFF', fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  label: { color: '#A1A1AA', fontSize: 13, marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: '#1C1C1E', color: '#FFF', borderRadius: 10, padding: 12, fontSize: 15 },
  help: { color: '#636366', fontSize: 12, marginTop: 6, lineHeight: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { color: '#E4E4E7', fontSize: 14, flex: 1 },
  value: { color: '#A1A1AA', fontSize: 13 },
  btn: { marginTop: 16, backgroundColor: '#FF3B30', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: '700' },
  ok: { color: '#34C759', fontSize: 13, marginTop: 8 },
  err: { color: '#FF453A', fontSize: 13, marginTop: 8 },
});
