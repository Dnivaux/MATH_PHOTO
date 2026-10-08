import React from 'react';
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';

interface CameraControlsProps {
  torchOn: boolean;
  onToggleTorch: () => void;
  onCapture: () => void;
  onPickImage: () => void;
  onOpenCalculator: () => void;
  isProcessing?: boolean;
}

export const CameraControls: React.FC<CameraControlsProps> = ({
  torchOn,
  onToggleTorch,
  onCapture,
  onPickImage,
  onOpenCalculator,
  isProcessing = false,
}) => {
  return (
    <View style={styles.controlsContainer}>
      {/* Top row actions (optional in overlay, or left/right of shutter) */}
      <View style={styles.bottomBar}>
        {/* Gallery button */}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onPickImage}
          disabled={isProcessing}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonLabel}>Galerie</Text>
        </TouchableOpacity>

        {/* Shutter Button */}
        <TouchableOpacity
          style={[styles.shutterOuter, isProcessing && styles.shutterDisabled]}
          onPress={onCapture}
          disabled={isProcessing}
          activeOpacity={0.8}
        >
          <View style={[styles.shutterInner, isProcessing && styles.shutterInnerProcessing]} />
        </TouchableOpacity>

        {/* Calculator Button */}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onOpenCalculator}
          disabled={isProcessing}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonLabel}>Calculatrice</Text>
        </TouchableOpacity>
      </View>

      {/* Floating Quick Action: Flash Toggle */}
      <TouchableOpacity
        style={[styles.floatingTorch, torchOn && styles.floatingTorchActive]}
        onPress={onToggleTorch}
        activeOpacity={0.7}
      >
        <Text style={styles.torchText}>{torchOn ? '⚡ ON' : '⚡ OFF'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  controlsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
    zIndex: 30,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  shutterDisabled: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF3B30',
  },
  shutterInnerProcessing: {
    backgroundColor: '#FF9500',
    transform: [{ scale: 0.85 }],
  },
  iconButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  floatingTorch: {
    position: 'absolute',
    top: -60,
    right: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  floatingTorchActive: {
    backgroundColor: '#FFCC00',
    borderColor: '#FFCC00',
  },
  torchText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
