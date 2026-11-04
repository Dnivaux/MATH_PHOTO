import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, ShieldCheck, Trash2 } from 'lucide-react-native';
import { AppBar, Banner, Button, Chip, Row, Section, Toggle } from '../components/ui';
import { showSnackbar } from '../components/ui/Snackbar';
import { AppSettings, getSettings, InstallMode, subscribeSettings, updateSettings } from '../config';
import { effectiveMode, ramGb, recommendedMode } from '../device';
import { EngineStatus, MathEngine } from '../engine/MathEngine';
import { VERSIONS } from '../engine/assets';
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  getModelState,
  ModelState,
  modelPath,
  refreshModel,
  subscribeModel,
  verifyModel,
} from '../explain/modelStore';
import { releaseExplainer } from '../explain/explainer';
import { Level, LEVEL_LABELS } from '../explain/prompt';
import { APP_VERSION, health } from '../services/api';
import { clearHistory } from '../state/history';
import { clearEvents, recentEvents } from '../storage/db';
import { radius, space, type, useTheme } from '../theme';

interface Props {
  navigation: any;
}

const MODES: { id: InstallMode; label: string }[] = [
  { id: 'auto', label: 'Automatique' },
  { id: 'complet', label: 'Complet' },
  { id: 'leger', label: 'Léger' },
];

const MODE_NAME = { complet: 'complet', leger: 'léger' } as const;

function mo(bytes: number) {
  return `${Math.round(bytes / 1e6)} Mo`;
}

function median(xs: number[]) {
  if (!xs.length) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<AppSettings>(getSettings());
  const [model, setModel] = useState<ModelState>(getModelState());
  const [engine, setEngine] = useState<EngineStatus>(MathEngine.status);
  const [serverCheck, setServerCheck] = useState<string | null>(null);
  const [bench, setBench] = useState<string[] | null>(null);

  useEffect(() => subscribeSettings(setS), []);
  useEffect(() => subscribeModel(setModel), []);
  useEffect(() => MathEngine.subscribe(st => setEngine({ ...st })), []);
  useEffect(() => {
    refreshModel();
  }, []);

  useEffect(() => {
    if (!s.devMode) {
      return;
    }
    recentEvents().then(ev => {
      const ms = (t: string, f = 'ms') => ev.filter(e => e.type === t && typeof e.data[f] === 'number').map(e => e.data[f] as number);
      const reasons: Record<string, number> = {};
      ev.filter(e => e.type === 'escalation').forEach(e => (reasons[e.data.reason] = (reasons[e.data.reason] ?? 0) + 1));
      const solves = ev.filter(e => e.type === 'solve');
      const local = solves.filter(e => e.data.route === 'local').length;
      const lines = [
        `OCR : médiane ${median(ms('ocr')) ?? '–'} ms sur ${ms('ocr').length} photos, confiance médiane ${median(ms('ocr', 'confidence')) ?? '–'}`,
        `Résolutions : ${local} sur le téléphone, ${solves.length - local} par le serveur (taux d'escalade ${solves.length ? Math.round(((solves.length - local) / solves.length) * 100) : 0} %)`,
        `Raisons d'escalade : ${
          Object.entries(reasons)
            .map(([k, v]) => `${k} ${v}`)
            .join(', ') || '–'
        }`,
        `Explications sur le téléphone : ${median(ms('explain', 'tokensPerSecond')) ?? '–'} jetons/s, chargement ${median(ms('explain', 'loadMs')) ?? '–'} ms`,
      ];
      setBench(lines);
    });
  }, [s.devMode]);

  const ram = ramGb();
  const rec = recommendedMode();
  const modeHint =
    ram !== null
      ? `Ton téléphone a ${String(ram).replace('.', ',')} Go de mémoire : mode ${MODE_NAME[rec]} recommandé.`
      : `Mode ${MODE_NAME[rec]} recommandé.`;

  const download = async () => {
    try {
      await downloadModel();
      showSnackbar('Modèle d’explication installé.');
    } catch (e) {
      showSnackbar((e as Error).message);
    }
  };

  const remove = () =>
    Alert.alert('Supprimer le modèle ?', 'Les explications passeront par le serveur (mode léger) jusqu’à sa réinstallation.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await releaseExplainer();
          await deleteModel();
        },
      },
    ]);

  const testServer = async () => {
    setServerCheck('Connexion…');
    try {
      const h = await health();
      setServerCheck(
        `Connecté : API ${h.api_version}${h.mock ? ' (factice)' : ''}, ${h.llm ? 'modèle de calcul disponible' : 'modèle de calcul indisponible'}.`,
      );
    } catch (e) {
      setServerCheck((e as Error).message);
    }
  };

  const exportBench = async () => {
    const ev = await recentEvents(500);
    Share.share({ title: 'Mesures Photo → Maths', message: JSON.stringify({ app: APP_VERSION, ram, events: ev }, null, 1) });
  };

  let modelBlock: React.ReactNode;
  switch (model.status) {
    case 'ready':
      modelBlock = (
        <View style={styles.pad}>
          <Text style={[type.body, { color: c.text }]}>{model.info.name}</Text>
          <Text style={[type.bodySm, { color: c.textMuted }]}>
            {mo(model.info.bytes)} · {model.info.verified ? 'empreinte vérifiée' : 'empreinte non vérifiée'}
          </Text>
          <View style={[styles.rowActions, styles.modelActions]}>
            {!model.info.verified ? <Button label="Vérifier" icon={ShieldCheck} variant="text" onPress={() => verifyModel()} /> : null}
            <Button label="Supprimer" icon={Trash2} variant="text" danger onPress={remove} />
          </View>
        </View>
      );
      break;
    case 'downloading':
      modelBlock = (
        <View style={styles.pad}>
          <Text style={[type.body, { color: c.text }]}>
            Téléchargement…{' '}
            {model.total ? `${Math.round(model.progress * 100)} % (${mo(model.bytes)} sur ${mo(model.total)})` : mo(model.bytes)}
          </Text>
          <View
            style={[styles.track, { backgroundColor: c.surfaceAlt }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ now: Math.round(model.progress * 100), min: 0, max: 100 }}>
            <View style={[styles.fill, { width: `${Math.round(model.progress * 100)}%`, backgroundColor: c.primary }]} />
          </View>
          <Button label="Annuler" variant="text" onPress={cancelDownload} style={styles.left} />
        </View>
      );
      break;
    case 'checking':
      modelBlock = <Row first title="Vérification de l’empreinte…" subtitle="Quelques secondes" />;
      break;
    case 'error':
      modelBlock = (
        <View style={styles.pad}>
          <Banner tone="error" message={model.message} action={{ label: 'Réessayer', onPress: download }} />
        </View>
      );
      break;
    default:
      modelBlock = (
        <Row
          first
          title="Non installé"
          subtitle="Environ 340 Mo. Il rédige les explications sur le téléphone, sans connexion."
          right={<Button label="Installer" icon={Download} variant="tonal" onPress={download} />}
        />
      );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
      <AppBar title="Réglages" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
        <Section title="Explications">
          <Row first title="Niveau" subtitle="Le vocabulaire et le détail des calculs s’adaptent." />
          <View style={styles.chips} accessibilityRole="radiogroup">
            {(Object.keys(LEVEL_LABELS) as Level[]).map(l => (
              <Chip key={l} label={LEVEL_LABELS[l]} selected={s.level === l} onPress={() => updateSettings({ level: l })} />
            ))}
          </View>
          <Row title="Mode" subtitle={`${modeHint} En mode léger, le serveur rédige les explications.`} />
          <View style={styles.chips} accessibilityRole="radiogroup">
            {MODES.map(m => (
              <Chip key={m.id} label={m.label} selected={s.mode === m.id} onPress={() => updateSettings({ mode: m.id })} />
            ))}
          </View>
          <Text style={[type.caption, styles.chipsNote, { color: c.textMuted }]}>Mode actif : {MODE_NAME[effectiveMode(s.mode)]}</Text>
        </Section>

        <Section
          title="Modèle d’explication"
          footer="Chaque égalité écrite par le modèle est revérifiée sur le téléphone avant d’être marquée comme vérifiée.">
          {modelBlock}
        </Section>

        <Section
          title="Serveur"
          footer="Le téléphone résout seul les calculs et les équations du premier degré. Le reste (second degré, systèmes, dérivées, primitives, limites) est envoyé au serveur, sans la photo.">
          <Row
            first
            title="Envoyer au serveur ce que le téléphone ne résout pas"
            right={<Toggle label="Envoyer au serveur" value={s.allowServer} onValueChange={v => updateSettings({ allowServer: v })} />}
          />
        </Section>

        <Section title="Données">
          <Row
            first
            title="Effacer l’historique"
            subtitle="Résolutions enregistrées et questions en attente"
            onPress={() =>
              Alert.alert('Effacer l’historique ?', undefined, [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Effacer', style: 'destructive', onPress: () => clearHistory() },
              ])
            }
          />
        </Section>

        <Section title="À propos">
          <Row
            first
            title="Photo → Maths"
            subtitle={`Version ${APP_VERSION} · OCR ${engine.ocrModel ?? 'pix2tex'} · CortexJS ${VERSIONS.cortex}`}
          />
          <Row
            title="Licences"
            subtitle="pix2tex (MIT), Qwen3 (Apache 2.0), llama.cpp (MIT), ONNX Runtime (MIT), CortexJS (MIT), KaTeX (MIT), MathLive (MIT), CMU Serif (OFL)"
          />
          <Row
            title="Outils de développement"
            subtitle="Adresse du serveur, mesures, seuils"
            right={<Toggle label="Outils de développement" value={s.devMode} onValueChange={v => updateSettings({ devMode: v })} />}
          />
        </Section>

        {s.devMode ? (
          <>
            <Section title="Serveur (développement)">
              <View style={styles.pad}>
                <Text style={[type.label, { color: c.textMuted }]}>Adresse de la gateway</Text>
                <TextInput
                  style={[styles.input, { color: c.text, borderColor: c.lineStrong, backgroundColor: c.bg }]}
                  value={s.serverUrl}
                  onChangeText={v => updateSettings({ serverUrl: v })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  accessibilityLabel="Adresse de la gateway"
                />
                <Text style={[type.label, styles.gap, { color: c.textMuted }]}>Jeton d’accès</Text>
                <TextInput
                  style={[styles.input, { color: c.text, borderColor: c.lineStrong, backgroundColor: c.bg }]}
                  value={s.apiKey}
                  onChangeText={v => updateSettings({ apiKey: v })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  accessibilityLabel="Jeton d’accès"
                />
                <Button label="Tester la connexion" variant="tonal" onPress={testServer} style={[styles.left, styles.gap]} />
                {serverCheck ? <Text style={[type.bodySm, styles.gap, { color: c.textMuted }]}>{serverCheck}</Text> : null}
                <Text style={[type.caption, styles.gap, { color: c.textMuted }]}>
                  Émulateur : http://10.0.2.2:8100 · téléphone branché : adb reverse tcp:8100 tcp:8100 puis http://localhost:8100
                </Text>
              </View>
            </Section>

            <Section title="Modèle (développement)">
              <View style={styles.pad}>
                <Text style={[type.label, { color: c.textMuted }]}>Adresse directe du fichier GGUF</Text>
                <TextInput
                  style={[styles.input, { color: c.text, borderColor: c.lineStrong, backgroundColor: c.bg }]}
                  value={s.modelUrl}
                  onChangeText={v => updateSettings({ modelUrl: v })}
                  placeholder="http://10.0.2.2:8000/explainer-0.6b-p20-q4_k_m.gguf"
                  placeholderTextColor={c.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  accessibilityLabel="Adresse directe du modèle"
                />
                <Text style={[type.caption, styles.gap, { color: c.textMuted }]} selectable>
                  Copie manuelle : adb push explainer-0.6b-p20-q4_k_m.gguf {modelPath()}
                </Text>
                <Button label="Rechercher le fichier" variant="text" onPress={() => refreshModel()} style={styles.left} />
              </View>
            </Section>

            <Section
              title="OCR (développement)"
              footer="Sous ce seuil, une formule lue sur une photo est aussi contrôlée par le serveur (raison ocr_low_confidence). À calibrer sur la planche de 50 photos.">
              <View style={styles.chips}>
                {[0.8, 0.85, 0.9, 0.95].map(v => (
                  <Chip
                    key={v}
                    label={String(v).replace('.', ',')}
                    selected={s.ocrMinConfidence === v}
                    onPress={() => updateSettings({ ocrMinConfidence: v })}
                  />
                ))}
              </View>
              <Row
                title="Moteur"
                subtitle={`CortexJS : ${engine.cortex} · OCR : ${engine.ocr}${engine.ocrLoadMs ? ` (chargé en ${engine.ocrLoadMs} ms)` : ''}${engine.error ? ` · ${engine.error}` : ''}`}
              />
            </Section>

            <Section title="Mesures sur ce téléphone" footer="Journal local (500 derniers événements). Rien n’est envoyé.">
              <View style={styles.pad}>
                {(bench ?? []).map((l, i) => (
                  <Text key={i} style={[type.bodySm, styles.benchLine, { color: c.text }]}>
                    {l}
                  </Text>
                ))}
                <View style={styles.rowActions}>
                  <Button label="Exporter" variant="tonal" onPress={exportBench} />
                  <Button label="Effacer" variant="text" onPress={() => clearEvents().then(() => setBench([]))} />
                </View>
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  chipsNote: { paddingHorizontal: space.lg, paddingBottom: space.md },
  pad: { padding: space.lg },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  modelActions: { marginTop: space.xs, marginLeft: -space.md },
  track: { height: 6, borderRadius: radius.full, overflow: 'hidden', marginTop: space.md },
  fill: { height: 6 },
  left: { alignSelf: 'flex-start' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.md, marginTop: space.xs, fontSize: 15 },
  gap: { marginTop: space.md },
  benchLine: { marginBottom: space.sm },
});
