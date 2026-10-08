import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CalcKey, KEY_PAGES } from './calculatorKeys';
import { MathFieldAction } from './MathFieldView';

interface Props {
  onKey: (key: CalcKey) => void;
  onAction: (action: MathFieldAction) => void;
  onSolve: () => void;
  solveLabel?: string;
}

const KIND_STYLE: Record<CalcKey['kind'], { bg: string; fg: string }> = {
  digit: { bg: '#2C2C2E', fg: '#FFFFFF' },
  op: { bg: '#3A3A3C', fg: '#FF9F0A' },
  fn: { bg: '#232326', fg: '#E4E4E7' },
  var: { bg: '#232326', fg: '#64D2FF' },
  cmp: { bg: '#3A3A3C', fg: '#FF9F0A' },
};

/** Clavier de calculatrice scientifique en trois pages */
export const CalculatorKeypad: React.FC<Props> = ({ onKey, onAction, onSolve, solveLabel = 'Résoudre' }) => {
  const [page, setPage] = useState(0);
  const current = KEY_PAGES[page];

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        {KEY_PAGES.map((p, i) => (
          <TouchableOpacity key={p.id} style={[styles.tab, i === page && styles.tabActive]} onPress={() => setPage(i)}>
            <Text style={[styles.tabText, i === page && styles.tabTextActive]}>{p.title}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <Ctl label="◀" onPress={() => onAction('left')} />
        <Ctl label="▶" onPress={() => onAction('right')} />
        <Ctl label="⌫" onPress={() => onAction('backspace')} accent />
        <Ctl label="AC" onPress={() => onAction('clear')} accent />
      </View>

      <View style={styles.grid}>
        {current.rows.map((row, r) => (
          <View key={`${current.id}-${r}`} style={styles.row}>
            {row.map(key => {
              const st = KIND_STYLE[key.kind];
              return (
                <TouchableOpacity
                  key={key.label}
                  style={[styles.key, { backgroundColor: st.bg }]}
                  onPress={() => onKey(key)}
                  activeOpacity={0.55}
                  accessibilityLabel={key.hint ?? key.label}
                >
                  <Text
                    style={[styles.keyText, { color: st.fg }, key.label.length > 3 && styles.keyTextSmall]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {key.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.solve} onPress={onSolve} activeOpacity={0.85}>
        <Text style={styles.solveText}>{solveLabel}</Text>
      </TouchableOpacity>
    </View>
  );
};

const Ctl: React.FC<{ label: string; onPress: () => void; accent?: boolean }> = ({ label, onPress, accent }) => (
  <TouchableOpacity style={[styles.ctl, accent && styles.ctlAccent]} onPress={onPress} activeOpacity={0.6}>
    <Text style={[styles.ctlText, accent && styles.ctlTextAccent]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 22,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  tab: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  tabActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  tabText: { color: '#8E8E93', fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: '#FFFFFF' },
  ctl: {
    minWidth: 38,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  ctlAccent: { backgroundColor: 'rgba(255,59,48,0.18)' },
  ctlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  ctlTextAccent: { color: '#FF453A' },
  grid: { gap: 7 },
  row: { flexDirection: 'row', gap: 7 },
  key: { flex: 1, height: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  keyText: { fontSize: 20, fontWeight: '500' },
  keyTextSmall: { fontSize: 15 },
  solve: {
    marginTop: 10,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  solveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
