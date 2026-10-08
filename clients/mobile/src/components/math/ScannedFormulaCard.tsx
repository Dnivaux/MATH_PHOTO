import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MathRenderer } from './MathRenderer';
import { getSettings } from '../../config';

interface ScannedFormulaCardProps {
  latex: string;
  isRecognizing: boolean;
  info?: { confidence: number | null; model: string; ms: number } | null;
  onEditInCalculator: (latex: string) => void;
  onSolve: (latex: string) => void;
  onDismiss: () => void;
}

export const ScannedFormulaCard: React.FC<ScannedFormulaCardProps> = ({
  latex,
  isRecognizing,
  info,
  onEditInCalculator,
  onSolve,
  onDismiss,
}) => {
  if (!latex && !isRecognizing) return null;

  return (
    <View style={styles.cardContainer}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>Formule détectée</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.closeButton}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mathArea}>
        {isRecognizing ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#FF3B30" size="small" />
            <Text style={styles.loadingText}>Lecture de la formule…</Text>
          </View>
        ) : (
          <MathRenderer
            math={latex}
            style={styles.mathView}
            fontSize={18}
          />
        )}
        {!isRecognizing && info && (
          <Text style={styles.infoText}>
            {info.model} · {info.ms} ms
            {info.confidence != null ? ` · confiance ${(info.confidence * 100).toFixed(0)} %` : ''}
          </Text>
        )}
        {!isRecognizing && info?.confidence != null && info.confidence < getSettings().ocrMinConfidence && (
          <Text style={styles.warnText}>Confiance faible : vérifie la formule avant de résoudre.</Text>
        )}
      </View>

      {!isRecognizing && latex.length > 0 && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => onEditInCalculator(latex)}
            activeOpacity={0.7}
          >
            <Text style={styles.editButtonText}>✏️ Modifier</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.solveButton}
            onPress={() => onSolve(latex)}
            activeOpacity={0.8}
          >
            <Text style={styles.solveButtonText}>Résoudre ➔</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    position: 'absolute',
    top: 96,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(25, 25, 30, 0.95)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  closeButton: {
    fontSize: 16,
    color: '#8E8E93',
    fontWeight: '600',
  },
  mathArea: {
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 8,
  },
  mathView: {
    width: '100%',
  },
  infoText: { color: '#8E8E93', fontSize: 11, marginTop: 6, textAlign: 'center' },
  warnText: { color: '#FF9F0A', fontSize: 12, marginTop: 4, textAlign: 'center' },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#EBEBF5',
    fontSize: 14,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  editButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  solveButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
  },
  solveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
