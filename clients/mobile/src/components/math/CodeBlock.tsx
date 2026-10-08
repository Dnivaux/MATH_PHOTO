import React from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface CodeBlockProps {
  code: string;
  onExportPy?: () => string;
  onExportNotebook?: () => string;
}

/** Code Python exécuté : sélectionnable (copie par appui long) et exportable */
export const CodeBlock: React.FC<CodeBlockProps> = ({ code, onExportPy, onExportNotebook }) => {
  const share = (content: string, title: string) => Share.share({ message: content, title });

  return (
    <View>
      <ScrollView horizontal style={styles.box} contentContainerStyle={styles.inner}>
        <Text selectable style={styles.code}>
          {code}
        </Text>
      </ScrollView>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => share(code, 'Code SymPy')}>
          <Text style={styles.btnText}>Copier / partager</Text>
        </TouchableOpacity>
        {onExportPy && (
          <TouchableOpacity style={styles.btn} onPress={() => share(onExportPy(), 'solution.py')}>
            <Text style={styles.btnText}>.py</Text>
          </TouchableOpacity>
        )}
        {onExportNotebook && (
          <TouchableOpacity style={styles.btn} onPress={() => share(onExportNotebook(), 'solution.ipynb')}>
            <Text style={styles.btnText}>.ipynb</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  box: { backgroundColor: '#0B0B0E', borderRadius: 10, maxHeight: 320 },
  inner: { padding: 12 },
  code: {
    color: '#D4D4D8',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
    lineHeight: 17,
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)' },
  btnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
});
