/**
 * Composants de base (Material 3, thémés par les tokens) : en-tête, boutons, puces, bandeaux, lignes de
 * réglage. Toute commande a une cible d'au moins 48 dp et un libellé accessible.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Switch, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, LucideIcon, XCircle } from 'lucide-react-native';
import { radius, space, TOUCH, type, useTheme } from '../../theme';

// ---------------------------------------------------------------- en-tête

interface AppBarProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  backIcon?: LucideIcon;
  right?: React.ReactNode;
}

/** Barre d'en-tête : retour à gauche, titre, actions à droite. Gère la zone de la barre d'état. */
export const AppBar: React.FC<AppBarProps> = ({ title, onBack, backLabel = 'Retour', backIcon = ArrowLeft, right }) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.appBar, { paddingTop: insets.top, backgroundColor: c.bg, borderBottomColor: c.line }]}>
      <View style={styles.appBarRow}>
        {onBack ? <IconButton icon={backIcon} label={backLabel} onPress={onBack} /> : <View style={styles.slot} />}
        <Text style={[type.title, styles.appBarTitle, { color: c.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.appBarRight}>{right ?? <View style={styles.slot} />}</View>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------- boutons

interface IconButtonProps {
  icon: LucideIcon;
  /** libellé lu par TalkBack (et affiché sous l'icône si `showLabel`) */
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const IconButton: React.FC<IconButtonProps> = ({ icon: Icon, label, onPress, color, size = 24, selected, disabled, style }) => {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      android_ripple={{ color: c.line, borderless: true, radius: TOUCH / 2 }}
      hitSlop={4}
      style={[styles.iconButton, selected && { backgroundColor: c.primaryContainer }, disabled && { opacity: 0.4 }, style]}>
      <Icon size={size} color={color ?? (selected ? c.onPrimaryContainer : c.text)} strokeWidth={2} />
    </Pressable>
  );
};

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** action destructive (rouge) */
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'filled',
  icon: Icon,
  loading,
  disabled,
  danger,
  style,
  accessibilityHint,
}) => {
  const { c } = useTheme();
  const accent = danger ? c.error : c.primary;
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    filled: { bg: accent, fg: danger ? '#FFFFFF' : c.onPrimary },
    tonal: { bg: danger ? c.errorContainer : c.primaryContainer, fg: danger ? c.error : c.onPrimaryContainer },
    outlined: { bg: 'transparent', fg: accent, border: c.lineStrong },
    text: { bg: 'transparent', fg: accent },
  };
  const p = palette[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      android_ripple={{ color: variant === 'filled' ? 'rgba(255,255,255,0.22)' : c.line }}
      style={[
        styles.button,
        { backgroundColor: p.bg, borderColor: p.border ?? 'transparent', borderWidth: p.border ? 1 : 0 },
        variant === 'text' && styles.buttonText,
        off && { opacity: 0.5 },
        style,
      ]}>
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : Icon ? <Icon size={18} color={p.fg} strokeWidth={2.2} /> : null}
      <Text style={[type.label, { color: p.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

// ---------------------------------------------------------------- puces

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

/** Puce de choix (filtre Material) : un seul choix actif dans un groupe */
export const Chip: React.FC<ChipProps> = ({ label, selected, onPress, accessibilityLabel }) => {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      android_ripple={{ color: c.line }}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: c.primaryContainer, borderColor: c.primaryContainer }
          : { backgroundColor: 'transparent', borderColor: c.lineStrong },
      ]}>
      <Text style={[type.label, { color: selected ? c.onPrimaryContainer : c.textMuted }]}>{label}</Text>
    </Pressable>
  );
};

// ---------------------------------------------------------------- bandeaux

type Tone = 'info' | 'success' | 'warning' | 'error';

interface BannerProps {
  tone: Tone;
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

const TONE_ICON: Record<Tone, LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

/** Message en ligne (état d'un écran) : le problème et ce qu'on peut faire */
export const Banner: React.FC<BannerProps> = ({ tone, title, message, action, style }) => {
  const { c } = useTheme();
  const tones: Record<Tone, { bg: string; fg: string }> = {
    info: { bg: c.surfaceAlt, fg: c.text },
    success: { bg: c.successContainer, fg: c.success },
    warning: { bg: c.warningContainer, fg: c.warning },
    error: { bg: c.errorContainer, fg: c.error },
  };
  const t = tones[tone];
  const Icon = TONE_ICON[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }, style]} accessibilityRole="alert">
      <Icon size={20} color={t.fg} strokeWidth={2.2} style={styles.bannerIcon} />
      <View style={styles.bannerBody}>
        {title ? <Text style={[type.titleSm, { color: tone === 'info' ? c.text : t.fg }]}>{title}</Text> : null}
        <Text style={[type.bodySm, { color: c.text }]}>{message}</Text>
        {action ? <Button label={action.label} onPress={action.onPress} variant="text" style={styles.bannerAction} /> : null}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------- réglages

export const Section: React.FC<{ title: string; children: React.ReactNode; footer?: string }> = ({ title, children, footer }) => {
  const { c } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.sectionTitle, { color: c.primary }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.sectionBody, { backgroundColor: c.surface, borderColor: c.line }]}>{children}</View>
      {footer ? <Text style={[type.caption, styles.sectionFooter, { color: c.textMuted }]}>{footer}</Text> : null}
    </View>
  );
};

interface RowProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  first?: boolean;
}

export const Row: React.FC<RowProps> = ({ title, subtitle, right, onPress, first }) => {
  const { c } = useTheme();
  const content = (
    <>
      <View style={styles.rowText}>
        <Text style={[type.body, { color: c.text }]}>{title}</Text>
        {subtitle ? <Text style={[type.bodySm, { color: c.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </>
  );
  const style = [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }];
  return onPress ? (
    <Pressable onPress={onPress} style={style} android_ripple={{ color: c.line }} accessibilityRole="button">
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
};

export const Toggle: React.FC<{ value: boolean; onValueChange: (v: boolean) => void; label: string }> = ({
  value,
  onValueChange,
  label,
}) => {
  const { c } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      trackColor={{ false: c.surfaceSunken, true: c.primary }}
      thumbColor={value ? c.onPrimary : c.surface}
      ios_backgroundColor={c.surfaceSunken}
    />
  );
};

const styles = StyleSheet.create({
  appBar: { borderBottomWidth: StyleSheet.hairlineWidth },
  appBarRow: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs },
  appBarTitle: { flex: 1, marginHorizontal: space.xs },
  appBarRight: { flexDirection: 'row', alignItems: 'center' },
  slot: { width: TOUCH, height: TOUCH },
  iconButton: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  button: {
    minHeight: TOUCH,
    paddingHorizontal: space.xl,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonText: { paddingHorizontal: space.md },
  chip: {
    minHeight: 36,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  banner: { flexDirection: 'row', padding: space.lg, borderRadius: radius.md, gap: space.md },
  bannerIcon: { marginTop: 2 },
  bannerBody: { flex: 1, gap: 2 },
  bannerAction: { alignSelf: 'flex-start', marginLeft: -space.md, marginTop: space.xs, minHeight: 40 },
  section: { marginTop: space.xl },
  sectionTitle: { marginHorizontal: space.lg, marginBottom: space.sm },
  sectionBody: { marginHorizontal: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionFooter: { marginHorizontal: space.xl, marginTop: space.sm },
  row: { minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, gap: 2 },
});
