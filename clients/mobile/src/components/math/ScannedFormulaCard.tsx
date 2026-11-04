/**
 * Feuille « Formule lue », au-dessus de la barre de la caméra : la formule reconnue (par le téléphone, ou relue
 * par le serveur), un avertissement si la lecture est incertaine (avec l'autre lecture du téléphone au choix), et
 * deux actions (corriger, résoudre). Quand
 * aucune lecture n'est exploitable, elle le dit et propose de saisir la formule : jamais de charabia à l'écran.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight, Keyboard, Pencil, X } from 'lucide-react-native';
import { radius, space, type, useTheme } from '../../theme';
import { Banner, Button, IconButton } from '../ui';
import { MathRenderer } from './MathRenderer';

interface Props {
  latex: string;
  isRecognizing: boolean;
  /** lecture du téléphone non confirmée : les deux lecteurs divergent et le serveur n'a pas pu relire */
  uncertain: boolean;
  /** l'autre lecture du téléphone, et l'action qui la met à la place de la première */
  alt: string | null;
  onSwap: () => void;
  bottom: number;
  onEdit: (latex: string) => void;
  onSolve: (latex: string) => void;
  onDismiss: () => void;
  /** lecture en cours : sur le téléphone, ou relecture par le serveur */
  stage: 'device' | 'server' | null;
  source: 'device' | 'server';
  /** aucune lecture montrable : le message à afficher */
  unreadable: string | null;
  onType: () => void;
}

export const ScannedFormulaCard: React.FC<Props> = ({
  latex,
  isRecognizing,
  uncertain,
  alt,
  onSwap,
  bottom,
  onEdit,
  onSolve,
  onDismiss,
  stage,
  source,
  unreadable,
  onType,
}) => {
  const { c } = useTheme();
  if (!latex && !isRecognizing && !unreadable) {
    return null;
  }
  const doubtful = source === 'device' && uncertain;
  const title = isRecognizing ? 'Lecture de la formule…' : unreadable ? 'Formule illisible' : 'Formule lue';
  return (
    <View style={[styles.sheet, { bottom, backgroundColor: c.surface, shadowColor: '#000' }]} accessibilityViewIsModal={false}>
      <View style={styles.head}>
        <Text style={[type.titleSm, { color: c.text }]} accessibilityRole="header">
          {title}
        </Text>
        {!isRecognizing ? <IconButton icon={X} label="Fermer" onPress={onDismiss} size={20} /> : null}
      </View>
      {isRecognizing ? (
        <View style={styles.loading}>
          <ActivityIndicator color={c.primary} />
          <Text style={[type.bodySm, { color: c.textMuted }]}>
            {stage === 'server' ? 'Lecture difficile : le serveur relit la photo…' : 'Sur ton téléphone, sans connexion.'}
          </Text>
        </View>
      ) : unreadable ? (
        <>
          <Banner tone="warning" message={unreadable} style={styles.banner} />
          <View style={styles.actions}>
            <Button label="Saisir la formule" icon={Keyboard} variant="outlined" onPress={onType} style={styles.action} />
            <Button label="Reprendre" onPress={onDismiss} style={styles.action} />
          </View>
        </>
      ) : (
        <>
          <View style={[styles.formula, { backgroundColor: c.bg, borderColor: c.line }]}>
            <MathRenderer math={latex} fontSize={22} minHeight={48} />
          </View>
          {source === 'server' ? <Text style={[type.caption, styles.source, { color: c.textMuted }]}>Lue par le serveur</Text> : null}
          {doubtful ? (
            <Banner
              tone="warning"
              message={
                alt
                  ? 'Deux lectures possibles, et le serveur n’a pas pu trancher : vérifie la formule, ou prends l’autre lecture.'
                  : 'Lecture incertaine, et le serveur n’a pas pu la relire : vérifie la formule avant de résoudre.'
              }
              style={styles.banner}
            />
          ) : null}
          {doubtful && alt ? (
            <View style={styles.altRow}>
              <View style={[styles.altFormula, { borderColor: c.line }]}>
                <MathRenderer math={alt} fontSize={16} minHeight={32} />
              </View>
              <Button label="Prendre celle-ci" icon={ArrowLeftRight} variant="outlined" onPress={onSwap} />
            </View>
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
  source: { marginTop: space.xs, textAlign: 'right' },
  altRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  altFormula: { flex: 1, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  action: { flex: 1 },
  primary: { flex: 1.4 },
});
