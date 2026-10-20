/**
 * Clavier de la calculatrice : barre (onglets + curseur + effacement), deux rangées de fonctions selon
 * l'onglet, pavé numérique fixe, bouton Résoudre. Trois familles de touches nettement distinctes :
 * chiffres clairs, opérations sur l'encre bleue, fonctions en retrait.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, Vibration } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Delete, LucideIcon } from 'lucide-react-native';
import { radius, space, TOUCH, type, useTheme } from '../../theme';
import { Button } from '../ui';
import { CalcKey, FUNCTION_PAGES, KeyLabel as Label, NUMPAD } from './calculatorKeys';
import { MathFieldAction } from './MathFieldView';

interface Props {
  onKey: (key: CalcKey) => void;
  onAction: (action: MathFieldAction) => void;
  onSolve: () => void;
  solveLabel: string;
  solveDisabled?: boolean;
}

const KEY_H = 50;

const KeyLabel: React.FC<{ label: Label; color: string; big: boolean }> = ({ label, color, big }) => {
  const size = big ? 22 : 16;
  if (typeof label === 'string') {
    return (
      <Text style={[styles.keyText, { color, fontSize: label.length > 3 ? 15 : size }]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    );
  }
  if ('num' in label) {
    return (
      <View style={styles.frac}>
        <Text style={[styles.fracText, { color }]}>{label.num}</Text>
        <View style={[styles.fracBar, { backgroundColor: color }]} />
        <Text style={[styles.fracText, { color }]}>{label.den}</Text>
      </View>
    );
  }
  return (
    <View style={styles.composed}>
      {label.pre ? <Text style={[styles.sup, { color }]}>{label.pre}</Text> : null}
      <Text style={[styles.keyText, { color, fontSize: label.base.length > 1 ? 16 : 20 }]}>{label.base}</Text>
      {label.sup ? <Text style={[styles.sup, { color }]}>{label.sup}</Text> : null}
      {label.sub ? <Text style={[styles.sub, { color }]}>{label.sub}</Text> : null}
    </View>
  );
};

/** Commande de la barre (curseur, effacement) ; appui long sur Effacer : tout effacer */
const Tool: React.FC<{ icon: LucideIcon; label: string; action: MathFieldAction; onAction: (a: MathFieldAction) => void }> = ({
  icon: Icon,
  label,
  action,
  onAction,
}) => {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => onAction(action)}
      onLongPress={action === 'backspace' ? () => onAction('clear') : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={action === 'backspace' ? 'Appui long pour tout effacer' : undefined}
      android_ripple={{ color: c.line, borderless: true, radius: TOUCH / 2 }}
      style={styles.tool}>
      <Icon size={22} color={c.text} strokeWidth={2} />
    </Pressable>
  );
};

export const CalculatorKeypad: React.FC<Props> = ({ onKey, onAction, onSolve, solveLabel, solveDisabled }) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const family = {
    digit: { bg: c.keyDigit, fg: c.text },
    op: { bg: c.keyOp, fg: c.onKeyOp },
    fn: { bg: c.keyFn, fg: c.text },
    var: { bg: c.keyFn, fg: c.primary },
  };

  const press = (key: CalcKey) => {
    Vibration.vibrate(8);
    onKey(key);
  };

  const renderRow = (row: CalcKey[], i: number) => (
    <View key={i} style={styles.row}>
      {row.map(key => {
        const f = family[key.kind];
        return (
          <Pressable
            key={key.id}
            onPress={() => press(key)}
            accessibilityRole="button"
            accessibilityLabel={key.a11y}
            android_ripple={{ color: c.line }}
            style={({ pressed }) => [
              styles.key,
              { backgroundColor: f.bg },
              key.kind === 'digit' && { borderColor: c.line, borderWidth: StyleSheet.hairlineWidth },
              pressed && styles.pressed,
            ]}>
            <KeyLabel label={key.label} color={f.fg} big={key.kind !== 'fn'} />
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.wrap, { backgroundColor: c.surface, borderTopColor: c.line, paddingBottom: insets.bottom + space.sm }]}>
      <View style={styles.bar}>
        <View style={[styles.tabs, { backgroundColor: c.surfaceAlt }]} accessibilityRole="tablist">
          {FUNCTION_PAGES.map((p, i) => {
            const on = i === page;
            return (
              <Pressable
                key={p.id}
                onPress={() => setPage(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.tab, on && { backgroundColor: c.surface, shadowColor: c.text }]}>
                <Text style={[type.label, { color: on ? c.text : c.textMuted }]} numberOfLines={1}>
                  {p.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Tool icon={ChevronLeft} label="Curseur à gauche" action="left" onAction={onAction} />
        <Tool icon={ChevronRight} label="Curseur à droite" action="right" onAction={onAction} />
        <Tool icon={Delete} label="Effacer" action="backspace" onAction={onAction} />
      </View>

      <View style={styles.grid}>
        {FUNCTION_PAGES[page].rows.map(renderRow)}
        <View style={[styles.divider, { backgroundColor: c.line }]} />
        {NUMPAD.map((r, i) => renderRow(r, 10 + i))}
      </View>

      <Button label={solveLabel} onPress={onSolve} disabled={solveDisabled} style={styles.solve} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm, paddingTop: space.sm },
  bar: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  tabs: { flex: 1, flexDirection: 'row', borderRadius: radius.sm, padding: 3, marginRight: space.xs },
  tab: { flex: 1, minHeight: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center', elevation: 0, shadowOpacity: 0 },
  tool: { width: 44, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  grid: { gap: 6 },
  row: { flexDirection: 'row', gap: 6 },
  key: { flex: 1, height: KEY_H, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  pressed: { opacity: 0.7 },
  keyText: { fontWeight: '500' },
  composed: { flexDirection: 'row', alignItems: 'center' },
  sup: { fontSize: 12, fontWeight: '600', marginBottom: 12 },
  sub: { fontSize: 11, fontWeight: '600', marginTop: 12 },
  frac: { alignItems: 'center' },
  fracText: { fontSize: 13, fontWeight: '600', lineHeight: 15 },
  fracBar: { height: 1.5, width: 18, marginVertical: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  solve: { marginTop: space.sm },
});
