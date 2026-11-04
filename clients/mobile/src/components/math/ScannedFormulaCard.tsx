/**
 * Feuille « Formule lue », au-dessus de la barre de la caméra : la formule reconnue, un avertissement si
 * la lecture est incertaine, et deux actions (corriger, résoudre).
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Pencil, X } from 'lucide-react-native';
import { radius, space, type, useTheme } from '../../theme';
import { Banner, Button, IconButton } from '../ui';
import { MathRenderer } from './MathRenderer';

interface Props {
  latex: string;
  isRecognizing: boolean;
  /** confiance de l'OCR (0..1) et seuil sous lequel on prévient */
  confidence: number | null;
  threshold: number;
  bottom: number;
  onEdit: (latex: string) => void;
  onSolve: (latex: string) => void;
  onDismiss: () => void;
}

export const ScannedFormulaCard: React.FC<Props> = ({
  latex,
  isRecognizing,
  confidence,
  threshold,
  bottom,
  onEdit,
  onSolve,
  onDismiss,
}) => {
  const { c } = useTheme();
  if (!latex && !isRecognizing) {
    return null;
  }
  const doubtful = confidence !== null && confidence < threshold;
  return (
    <View style={[styles.sheet, { bottom, backgroundColor: c.surface, shadowColor: '#000' }]} accessibilityViewIsModal={false}>
      <View style={styles.head}>
        <Text style={[type.titleSm, { color: c.text }]} accessibilityRole="header">
          {isRecognizing ? 'Lecture de la formule…' : 'Formule lue'}
        </Text>
        {!isRecognizing ? <IconButton icon={X} label="Fermer" onPress={onDismiss} size={20} /> : null}
      </View>
      {isRecognizing ? (
        <View style={styles.loading}>
          <ActivityIndicator color={c.primary} />
          <Text style={[type.bodySm, { color: c.textMuted }]}>Sur ton téléphone, sans connexion.</Text>
        </View>
      ) : (
        <>
          <View style={[styles.formula, { backgroundColor: c.bg, borderColor: c.line }]}>
            <MathRenderer math={latex} fontSize={22} minHeight={48} />
          </View>
          {doubtful ? (
            <Banner
              tone="warning"
              message="Lecture incertaine : vérifie la formule. En résolvant, je la ferai aussi contrôler par le serveur."
              style={styles.banner}
            />
          ) : null}
          <View style={styles.actions}>
            <Button label="Corriger" icon={Pencil} variant="outlined" onPress={() => onEdit(latex)} style={styles.action} />
            <Button label="Résoudre" onPress={() => onSolve(latex)} style={[styles.action, styles.primary]} />
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    borderRadius: radius.lg,
    padding: space.lg,
    paddingTop: space.sm,
    zIndex: 60,
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  formula: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm, paddingHorizontal: space.md },
  banner: { marginTop: space.md },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  action: { flex: 1 },
  primary: { flex: 1.4 },
});
