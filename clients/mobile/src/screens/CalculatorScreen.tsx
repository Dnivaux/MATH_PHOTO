import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Braces, History, X } from 'lucide-react-native';
import { AppBar, IconButton } from '../components/ui';
import { MathRenderer } from '../components/math/MathRenderer';
import { MathFieldHandle, MathFieldView } from '../components/math/MathFieldView';
import { CalculatorKeypad } from '../components/math/CalculatorKeypad';
import { Analysis, MathEngine } from '../engine/MathEngine';
import { cleanLatex } from '../engine/latexPreprocess';
import { getSettings } from '../config';
import { KIND_LABELS } from '../pipeline/types';
import { radius, space, type, useTheme } from '../theme';

interface Props {
  route: any;
  navigation: any;
}

/**
 * Calculatrice : saisie en 2D (fractions, puissances, racines…) avec le clavier de l'app. Les calculs se
 * font en direct sur le téléphone ; pour le reste, l'écran dit où le problème sera résolu.
 */
export const CalculatorScreen: React.FC<Props> = ({ route, navigation }) => {
  const { c, scheme } = useTheme();
  const initial = route.params?.initialLatex || '';
  const field = useRef<MathFieldHandle>(null);
  const [latex, setLatex] = useState(initial);
  const [preview, setPreview] = useState<Analysis | null>(null);
  const [showLatex, setShowLatex] = useState(false);
  const reqId = useRef(0);

  // une formule lue par l'OCR arrive ici pour être corrigée
  useEffect(() => {
    if (route.params?.initialLatex !== undefined) {
      field.current?.set(route.params.initialLatex);
    }
  }, [route.params?.initialLatex]);

  useEffect(() => {
    const id = ++reqId.current;
    const src = cleanLatex(latex);
    if (!src) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const a = await MathEngine.analyze(src);
        if (id === reqId.current) {
          setPreview(a);
        }
      } catch {
        if (id === reqId.current) {
          setPreview(null);
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [latex]);

  const solvable = !!preview && preview.valid && preview.route !== 'none';
  const handleSolve = () => {
    if (!cleanLatex(latex)) {
      return;
    }
    navigation.navigate('Solution', { latex });
  };

  let hint: string;
  let hintColor = c.textMuted;
  if (!latex.trim()) {
    hint = 'Tape un calcul, une équation, une fonction à tracer…';
  } else if (!preview) {
    hint = '';
  } else if (!preview.valid) {
    hint = getSettings().allowServer ? 'Formule incomplète ou non reconnue' : 'Formule incomplète';
  } else if (preview.route === 'none') {
    hint =
      preview.kind === 'inequality'
        ? 'Les inéquations ne sont pas encore prises en charge'
        : 'Je ne sais pas encore traiter cette expression';
    hintColor = c.warning;
  } else if (preview.route === 'server') {
    hint = `${preview.label ?? KIND_LABELS[preview.kind]} · se résout sur le serveur${getSettings().allowServer ? '' : ' (désactivé dans les réglages)'}`;
  } else if (preview.kind === 'function') {
    hint = 'Fonction · le graphe est tracé sur ton téléphone';
  } else if (preview.kind === 'linear') {
    hint = 'Équation du premier degré · résolue sur ton téléphone';
  } else {
    hint = '';
  }

  const value = preview?.route === 'local' && (preview.kind === 'arithmetic' || preview.kind === 'check') ? preview.result : null;

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
      <AppBar
        title="Calculatrice"
        onBack={() => navigation.goBack()}
        backIcon={X}
        backLabel="Fermer"
        right={
          <>
            <IconButton
              icon={Braces}
              label={showLatex ? 'Masquer le LaTeX' : 'Modifier le LaTeX'}
              selected={showLatex}
              onPress={() => setShowLatex(v => !v)}
            />
            <IconButton icon={History} label="Historique" onPress={() => navigation.navigate('History')} />
          </>
        }
      />

      <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.display, { backgroundColor: c.surface, borderColor: c.line }]}>
          <MathFieldView ref={field} initialLatex={initial} onChange={setLatex} />
          <View style={[styles.preview, { borderTopColor: c.line }]} accessibilityLiveRegion="polite">
            {value ? (
              <View style={styles.valueRow}>
                <View style={styles.flex}>
                  <MathRenderer math={`= ${value.latex}`} color={c.primary} fontSize={24} align="left" minHeight={40} />
                  {value.numeric ? (
                    <MathRenderer math={`\\approx ${value.numeric}`} color={c.textMuted} fontSize={16} align="left" minHeight={28} />
                  ) : null}
                </View>
              </View>
            ) : hint ? (
              <Text style={[type.bodySm, { color: hintColor }]}>{hint}</Text>
            ) : null}
          </View>
        </View>

        {showLatex ? (
          <View style={styles.latexBox}>
            <Text style={[type.label, { color: c.textMuted }]} nativeID="latexLabel">
              LaTeX de la formule
            </Text>
            <TextInput
              style={[styles.latexInput, { backgroundColor: c.surface, color: c.text, borderColor: c.line }]}
              value={latex}
              onChangeText={v => {
                setLatex(v);
                field.current?.set(v);
              }}
              accessibilityLabelledBy="latexLabel"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              placeholder="\frac{1}{2} + x = 3"
              placeholderTextColor={c.textFaint}
            />
          </View>
        ) : null}
      </ScrollView>

      <CalculatorKeypad
        onKey={key => field.current?.insert(key.insert)}
        onAction={action => field.current?.run(action)}
        onSolve={handleSolve}
        solveLabel={preview?.kind === 'function' ? 'Tracer' : value ? 'Voir le détail' : 'Résoudre'}
        solveDisabled={!latex.trim() || (preview !== null && !solvable && preview.valid)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  body: { padding: space.lg, paddingBottom: space.md },
  display: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.sm },
  preview: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 52, justifyContent: 'center', paddingTop: space.sm, marginTop: space.xs },
  valueRow: { flexDirection: 'row', alignItems: 'center' },
  latexBox: { marginTop: space.lg, gap: space.sm },
  latexInput: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    fontFamily: 'monospace',
    fontSize: 15,
    minHeight: 56,
  },
});
