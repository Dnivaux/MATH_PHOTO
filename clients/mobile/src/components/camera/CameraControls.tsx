/**
 * Barre du bas de la caméra : galerie, déclencheur, calculatrice. Trois colonnes égales : le déclencheur
 * est au centre exact. Pendant la lecture, un anneau tourne autour du déclencheur.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calculator, Images, LucideIcon } from 'lucide-react-native';
import { camera, space, TOUCH, type } from '../../theme';

interface Props {
  onCapture: () => void;
  onPickImage: () => void;
  onOpenCalculator: () => void;
  isProcessing: boolean;
  disabled?: boolean;
}

export const CONTROLS_HEIGHT = 120;

const SideButton: React.FC<{ icon: LucideIcon; label: string; onPress: () => void }> = ({ icon: Icon, label, onPress }) => (
  <Pressable
    onPress={onPress}
    style={styles.side}
    accessibilityRole="button"
    accessibilityLabel={label}
    android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true, radius: 40 }}>
    <View style={styles.sideIcon}>
      <Icon size={24} color={camera.text} strokeWidth={2} />
    </View>
    <Text style={[type.caption, styles.sideLabel]}>{label}</Text>
  </Pressable>
);

export const CameraControls: React.FC<Props> = ({ onCapture, onPickImage, onOpenCalculator, isProcessing, disabled }) => {
  const insets = useSafeAreaInsets();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isProcessing) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [isProcessing, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
      <SideButton icon={Images} label="Galerie" onPress={onPickImage} />
      <View style={styles.center}>
        <Pressable
          onPress={onCapture}
          disabled={isProcessing || disabled}
          accessibilityRole="button"
          accessibilityLabel={isProcessing ? 'Lecture de la formule en cours' : 'Prendre la photo'}
          accessibilityState={{ busy: isProcessing, disabled: !!disabled }}
          style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }, disabled && { opacity: 0.5 }]}>
          {isProcessing ? <Animated.View style={[styles.progress, { transform: [{ rotate }] }]} /> : null}
          <View style={[styles.shutterInner, isProcessing && styles.shutterBusy]} />
        </Pressable>
      </View>
      <SideButton icon={Calculator} label="Calculatrice" onPress={onOpenCalculator} />
    </View>
  );
};

const SHUTTER = 76;

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: space.lg,
    backgroundColor: camera.chrome,
    zIndex: 40,
  },
  side: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: TOUCH + 20, gap: space.xs },
  sideIcon: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sideLabel: { color: camera.textMuted },
  center: { flex: 1, alignItems: 'center' },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: camera.shutter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: SHUTTER - 18, height: SHUTTER - 18, borderRadius: (SHUTTER - 18) / 2, backgroundColor: camera.shutter },
  shutterBusy: { transform: [{ scale: 0.6 }], opacity: 0.85 },
  progress: {
    position: 'absolute',
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: 'transparent',
    borderTopColor: camera.busy,
    top: -4,
    left: -4,
  },
});
