import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MathRenderer } from '../components/math/MathRenderer';
import { MathFieldHandle, MathFieldView } from '../components/math/MathFieldView';
import { CalculatorKeypad } from '../components/math/CalculatorKeypad';
import { MathEngine } from '../engine/MathEngine';
import { preprocessLatex } from '../engine/latexPreprocess';
import { classify, KIND_LABELS, ProblemKind } from '../engine/templates';
import { solve } from '../pipeline/solve';
import { getHistory, HistoryItem, pushHistory, subscribeHistory } from '../state/history';

interface CalculatorScreenProps {
  route: any;
  navigation: any;
}

type Preview =
  | { state: 'empty' }
  | { state: 'incomplete' }
  | { state: 'value'; exact: string; numeric?: string | null }
  | { state: 'kind'; kind: ProblemKind };

/**
 * Calculatrice : saisie en 2D (fractions, puissances, racines…) avec le
 * clavier de l'app ; l'expression est convertie en LaTeX pour le moteur.
 * Les calculs numériques s'affichent en direct, le reste se résout avec « Résoudre ».
 */
export const CalculatorScreen: React.FC<CalculatorScreenProps> = ({ route, navigation }) => {
  const initial: string = route.params?.initialLatex || '';
  const field = useRef<MathFieldHandle>(null);
  const [latex, setLatex] = useState(initial);
  const [preview, setPreview] = useState<Preview>({ state: 'empty' });
  const [showLatex, setShowLatex] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(getHistory());
  const reqId = useRef(0);

  useEffect(() => subscribeHistory(setHistory), []);

  // Une expression reconnue par l'OCR arrive ici pour être corrigée
  useEffect(() => {
    if (route.params?.initialLatex !== undefined) field.current?.set(route.params.initialLatex);
  }, [route.params?.initialLatex]);

  // Résultat en direct : calcul numérique immédiat (CortexJS, sinon SymPy)
  useEffect(() => {
    const id = ++reqId.current;
    if (!latex.trim()) {
      setPreview({ state: 'empty' });
      return;
    }
    const t = setTimeout(async () => {
      try {
        const pre = preprocessLatex(latex);
        const parsed = await MathEngine.parse(pre.toParse);
        if (id !== reqId.current) return;
        if (!parsed.isValid) {
          setPreview({ state: 'incomplete' });
          return;
        }
        const kind = classify(pre, parsed.json);
        if (kind !== 'arithmetic') {
          setPreview({ state: 'kind', kind });
          return;
        }
        const r = await solve(latex);
        if (id === reqId.current) setPreview({ state: 'value', exact: r.resultLatex, numeric: r.numericLatex });
      } catch {
        if (id === reqId.current) setPreview({ state: 'incomplete' });
      }
    }, 280);
    return () => clearTimeout(t);
  }, [latex]);

  const handleSolve = () => {
    if (!latex.trim()) return;
    pushHistory(latex, preview.state === 'value' ? preview.exact : undefined);
    navigation.navigate('Solution', { latex });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBtn}>✕ Fermer</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calculatrice</Text>
        <TouchableOpacity onPress={() => setShowLatex(!showLatex)}>
          <Text style={[styles.headerBtn, showLatex && { color: '#FF453A' }]}>LaTeX</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.display}>
          <MathFieldView ref={field} initialLatex={initial} onChange={setLatex} />
          <View style={styles.previewRow}>
            {preview.state === 'value' && (
              <>
                <Text style={styles.equal}>=</Text>
                <View style={{ flex: 1 }}>
                  <MathRenderer math={preview.exact} color="#34C759" fontSize={24} minHeight={40} />
                  {preview.numeric ? (
                    <MathRenderer math={`\\approx ${preview.numeric}`} color="#8E8E93" fontSize={15} minHeight={26} />
                  ) : null}
                </View>
              </>
            )}
            {preview.state === 'kind' && (
              <Text style={styles.hint}>{KIND_LABELS[preview.kind]} : appuie sur « Résoudre » pour les étapes</Text>
            )}
            {preview.state === 'incomplete' && <Text style={styles.hint}>Expression incomplète</Text>}
            {preview.state === 'empty' && <Text style={styles.hint}>Tape une expression, une équation, une fonction…</Text>}
          </View>
        </View>

        {showLatex && (
          <View style={styles.latexBox}>
            <Text style={styles.latexLabel}>LaTeX (modifiable)</Text>
            <TextInput
              style={styles.latexInput}
              value={latex}
              onChangeText={v => {
                setLatex(v);
                field.current?.set(v);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.history}>
            <Text style={styles.latexLabel}>Historique</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {history.map(h => (
                <TouchableOpacity
                  key={h.at}
                  style={styles.histItem}
                  onPress={() => {
                    field.current?.set(h.latex);
                    setLatex(h.latex);
                  }}
                >
                  <Text style={styles.histText} numberOfLines={1}>
                    {h.latex}
                    {h.result ? `  =  ${h.result}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <CalculatorKeypad
        onKey={key => field.current?.insert(key.insert)}
        onAction={action => field.current?.run(action)}
        onSolve={handleSolve}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F12' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerBtn: { color: '#8E8E93', fontSize: 15, fontWeight: '600' },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  body: { paddingHorizontal: 14, paddingBottom: 12 },
  display: { backgroundColor: '#1C1C1E', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 6,
    marginTop: 4,
  },
  equal: { color: '#FF9F0A', fontSize: 24, fontWeight: '600' },
  hint: { color: '#636366', fontSize: 13, fontStyle: 'italic', paddingVertical: 8 },
  latexBox: { marginTop: 12 },
  latexLabel: {
    color: '#636366',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  latexInput: {
    backgroundColor: '#1C1C1E',
    color: '#FFF',
    borderRadius: 12,
    padding: 10,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  history: { marginTop: 14 },
  histItem: { backgroundColor: '#1C1C1E', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, maxWidth: 260 },
  histText: { color: '#A1A1AA', fontSize: 12, fontFamily: 'monospace' },
});
