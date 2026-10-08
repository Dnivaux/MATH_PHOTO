import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MathRenderer } from '../components/math/MathRenderer';
import { GraphView } from '../components/math/GraphView';
import { CodeBlock } from '../components/math/CodeBlock';
import {
  explainSolution,
  ROUTE_LABELS,
  solve,
  SolveError,
  SolveResult,
  toNotebook,
  toPythonFile,
  CodeAttempt,
  Timing,
} from '../pipeline/solve';
import { MathEngine } from '../engine/MathEngine';

interface SolutionDetailScreenProps {
  route: any;
  navigation: any;
}

type ExplainState = { status: 'idle' | 'loading' | 'done' | 'error'; text?: string };

export const SolutionDetailScreen: React.FC<SolutionDetailScreenProps> = ({ route, navigation }) => {
  const latex: string = route.params?.latex || '';
  const [progress, setProgress] = useState('Préparation…');
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<{ message: string; attempts: CodeAttempt[]; timings: Timing[] } | null>(null);
  const [explanation, setExplanation] = useState<ExplainState>({ status: 'idle' });
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [showCode, setShowCode] = useState(false);

  const run = useCallback(async () => {
    setResult(null);
    setError(null);
    setExplanation({ status: 'idle' });
    try {
      const r = await solve(latex, setProgress);
      setResult(r);
    } catch (e: any) {
      setError({
        message: e?.message ?? String(e),
        attempts: e instanceof SolveError ? e.attempts : [],
        timings: e instanceof SolveError ? e.timings : [],
      });
    }
  }, [latex]);

  useEffect(() => {
    run();
  }, [run]);

  // Étape 8 : explication rédigée à partir des étapes vérifiées
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setExplanation({ status: 'loading' });
    const t0 = Date.now();
    explainSolution(result)
      .then(text => {
        if (cancelled) return;
        result.timings.push({ label: 'Explication (serveur)', ms: Date.now() - t0 });
        setExplanation(text ? { status: 'done', text } : { status: 'error', text: 'escalade serveur désactivée' });
      })
      .catch(e => !cancelled && setExplanation({ status: 'error', text: e?.message ?? String(e) }));
    return () => {
      cancelled = true;
    };
  }, [result]);

  const edit = () => navigation.navigate('Calculator', { initialLatex: result?.latex ?? latex });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Résolution</Text>
        <TouchableOpacity onPress={edit}>
          <Text style={styles.editButton}>Modifier</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} scrollEnabled={scrollEnabled}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Énoncé {result?.kindLabel ? `· ${result.kindLabel}` : ''}</Text>
          <MathRenderer math={result?.latex ?? latex} fontSize={20} />
        </View>

        {!result && !error && (
          <View style={[styles.card, styles.center]}>
            <ActivityIndicator color="#FF3B30" />
            <Text style={styles.progress}>{progress}</Text>
          </View>
        )}

        {error && (
          <View style={[styles.card, styles.errorCard]}>
            <Text style={[styles.sectionLabel, { color: '#FF453A' }]}>Échec</Text>
            <Text style={styles.body}>{error.message}</Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.btn} onPress={run}>
                <Text style={styles.btnText}>Réessayer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={edit}>
                <Text style={styles.btnText}>Corriger le LaTeX</Text>
              </TouchableOpacity>
            </View>
            <Attempts attempts={error.attempts} />
            <Timings timings={error.timings} />
          </View>
        )}

        {result && (
          <>
            <View style={[styles.card, styles.resultCard]}>
              <Text style={[styles.sectionLabel, { color: '#34C759' }]}>Résultat</Text>
              <MathRenderer math={result.resultLatex} color="#34C759" fontSize={22} />
              {result.verified === false && <Text style={styles.warn}>⚠︎ Résultat non vérifié par le serveur</Text>}
              {result.numericLatex ? (
                <MathRenderer math={`\\approx ${result.numericLatex}`} color="#8E8E93" fontSize={16} />
              ) : null}
              <Text style={styles.routeText}>{ROUTE_LABELS[result.route]}</Text>
            </View>

            {result.steps.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Étapes (calculées par SymPy)</Text>
                {result.steps.map((step, i) => (
                  <View key={i} style={styles.stepCard}>
                    <View style={styles.stepHeaderRow}>
                      <View style={styles.stepBadge}>
                        <Text style={styles.stepBadgeText}>{i + 1}</Text>
                      </View>
                      <Text style={styles.stepLabel}>{step.label}</Text>
                    </View>
                    <MathRenderer math={step.latex} fontSize={17} />
                  </View>
                ))}
              </>
            )}

            {result.plot && (
              <>
                <Text style={styles.sectionHeader}>Graphe</Text>
                <GraphView plot={result.plot} onGesture={active => setScrollEnabled(!active)} />
                <Text style={styles.muted}>Glisser pour déplacer · pincer pour zoomer · toucher pour lire une valeur</Text>
              </>
            )}

            <Text style={styles.sectionHeader}>Explication</Text>
            <View style={styles.card}>
              {explanation.status === 'loading' && (
                <View style={styles.rowCenter}>
                  <ActivityIndicator color="#8E8E93" size="small" />
                  <Text style={styles.progress}>Rédaction de l'explication…</Text>
                </View>
              )}
              {explanation.status === 'done' && explanation.text && (
                <MathRenderer math={explanation.text} mode="text" fontSize={18} />
              )}
              {explanation.status === 'error' && (
                <Text style={styles.muted}>
                  Explication rédigée indisponible ({explanation.text}). Le LLM de raisonnement embarqué n'est pas
                  encore intégré ; les étapes ci-dessus sont calculées et vérifiées par SymPy.
                </Text>
              )}
            </View>

            {result.code && (
              <>
                <TouchableOpacity onPress={() => setShowCode(!showCode)}>
                  <Text style={styles.sectionHeader}>{showCode ? '▾' : '▸'} Code SymPy exécuté</Text>
                </TouchableOpacity>
                {showCode && (
                  <CodeBlock
                    code={result.code}
                    onExportPy={() => toPythonFile(result)}
                    onExportNotebook={() => toNotebook(result)}
                  />
                )}
              </>
            )}

            {result.attempts.some(a => a.error) && <Attempts attempts={result.attempts.filter(a => a.error)} />}

            <Timings timings={result.timings} warnings={result.warnings} />
          </>
        )}
      </ScrollView>
    </View>
  );
};

const Attempts: React.FC<{ attempts: CodeAttempt[] }> = ({ attempts }) => {
  const [open, setOpen] = useState(false);
  if (!attempts.length) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <TouchableOpacity onPress={() => setOpen(!open)}>
        <Text style={styles.sectionHeaderSmall}>
          {open ? '▾' : '▸'} Tentatives en échec ({attempts.filter(a => a.error).length})
        </Text>
      </TouchableOpacity>
      {open &&
        attempts.map((a, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text style={styles.muted}>
              {a.source === 'template' ? 'Gabarit' : 'LLM'} — {a.error ?? 'ok'}
            </Text>
            <CodeBlock code={a.code} />
          </View>
        ))}
    </View>
  );
};

const Timings: React.FC<{ timings: Timing[]; warnings?: string[] }> = ({ timings, warnings }) => {
  const total = timings.reduce((s, t) => s + t.ms, 0);
  const st = MathEngine.status;
  return (
    <View style={styles.debugCard}>
      <Text style={styles.sectionHeaderSmall}>Mesures</Text>
      {timings.map((t, i) => (
        <View key={i} style={styles.timingRow}>
          <Text style={styles.timingLabel}>{t.label}</Text>
          <Text style={styles.timingValue}>{t.ms} ms</Text>
        </View>
      ))}
      <View style={styles.timingRow}>
        <Text style={[styles.timingLabel, { fontWeight: '700' }]}>Total</Text>
        <Text style={styles.timingValue}>{total} ms</Text>
      </View>
      <Text style={styles.muted}>
        Python : {st.python}
        {st.pythonLoadMs ? ` (chargé en ${st.pythonLoadMs} ms, ${st.pythonMode})` : ''} · OCR : {st.ocr}
      </Text>
      {warnings?.map((w, i) => (
        <Text key={i} style={styles.muted}>
          ⚠︎ {w}
        </Text>
      ))}
    </View>
  );
};

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
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  backButton: { color: '#FF3B30', fontSize: 16, fontWeight: '600' },
  editButton: { color: '#8E8E93', fontSize: 15, fontWeight: '600' },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 48 },
  card: {
    backgroundColor: '#18181B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  center: { alignItems: 'center', gap: 10 },
  resultCard: { backgroundColor: 'rgba(52, 199, 89, 0.08)', borderColor: 'rgba(52, 199, 89, 0.3)' },
  errorCard: { borderColor: 'rgba(255, 69, 58, 0.4)' },
  sectionLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  sectionHeader: { color: '#FFF', fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 10 },
  sectionHeaderSmall: { color: '#A1A1AA', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  routeText: { color: '#8E8E93', fontSize: 12, marginTop: 6, textAlign: 'center' },
  progress: { color: '#D4D4D8', fontSize: 14 },
  body: { color: '#E4E4E7', fontSize: 14, lineHeight: 20 },
  muted: { color: '#8E8E93', fontSize: 12, lineHeight: 17, marginTop: 4 },
  warn: { color: '#FF9F0A', fontSize: 13, textAlign: 'center', marginTop: 4 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  rowCenter: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)' },
  btnText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  stepCard: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  stepHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  stepBadge: {
    backgroundColor: '#FF3B30',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  stepLabel: { color: '#E4E4E7', fontSize: 14, fontWeight: '600', flex: 1 },
  debugCard: { marginTop: 18, padding: 12, borderRadius: 12, backgroundColor: '#111114' },
  timingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  timingLabel: { color: '#A1A1AA', fontSize: 12 },
  timingValue: { color: '#D4D4D8', fontSize: 12, fontVariant: ['tabular-nums'] },
});
