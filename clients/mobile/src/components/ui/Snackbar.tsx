/**
 * Snackbar (Material) : message bref en bas de l'écran, avec une action facultative.
 * Remplace les Alert natifs pour les retours qui n'exigent pas de décision.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, type, useTheme } from '../../theme';

interface SnackMessage {
  id: number;
  text: string;
  action?: { label: string; onPress: () => void };
  /** décalage depuis le bas (au-dessus d'une barre d'outils) */
  offset?: number;
}

type Listener = (m: SnackMessage | null) => void;
const listeners = new Set<Listener>();
let counter = 0;

export function showSnackbar(text: string, opts: { action?: SnackMessage['action']; offset?: number } = {}) {
  const m = { id: ++counter, text, ...opts };
  listeners.forEach(l => l(m));
  AccessibilityInfo.announceForAccessibility(text);
}

export const SnackbarHost: React.FC = () => {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<SnackMessage | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const l: Listener = m => {
      clearTimeout(timer.current);
      setMsg(m);
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      timer.current = setTimeout(
        () => {
          Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setMsg(null));
        },
        m?.action ? 6000 : 4000,
      );
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer.current);
    };
  }, [anim]);

  if (!msg) {
    return null;
  }
  // surface inversée : se lit sur la caméra comme sur le papier
  const bg = scheme === 'dark' ? '#E6E8EE' : '#23262F';
  const fg = scheme === 'dark' ? '#14161C' : '#F2F3F6';
  const actionColor = scheme === 'dark' ? '#1F47C7' : '#A9BEFF';
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: insets.bottom + space.lg + (msg.offset ?? 0),
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}>
      <View style={[styles.bar, { backgroundColor: bg, shadowColor: c.text }]} accessibilityLiveRegion="polite">
        <Text style={[type.bodySm, styles.text, { color: fg }]}>{msg.text}</Text>
        {msg.action ? (
          <Pressable
            onPress={() => {
              msg.action?.onPress();
              setMsg(null);
            }}
            accessibilityRole="button"
            style={styles.action}>
            <Text style={[type.label, { color: actionColor }]}>{msg.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
  bar: {
    minHeight: 48,
    borderRadius: radius.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 6,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  text: { flex: 1, paddingVertical: space.md },
  action: { minHeight: 48, paddingHorizontal: space.md, justifyContent: 'center' },
});
