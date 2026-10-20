import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, PhotoFile, useCameraDevice, useCameraFormat, useCameraPermission } from 'react-native-vision-camera';
import ImageCropPicker from 'react-native-image-crop-picker';
import { Calculator, Camera as CameraIcon, CloudOff, History, Settings, Zap, ZapOff } from 'lucide-react-native';
import { CameraOverlayMask } from '../components/camera/CameraOverlayMask';
import { ResizableBoundingBox } from '../components/camera/ResizableBoundingBox';
import { CameraControls, CONTROLS_HEIGHT } from '../components/camera/CameraControls';
import { ScannedFormulaCard } from '../components/math/ScannedFormulaCard';
import { Button } from '../components/ui';
import { showSnackbar } from '../components/ui/Snackbar';
import { useResizableBox } from '../hooks/useResizableBox';
import { EngineStatus, FractionRect, MathEngine } from '../engine/MathEngine';
import { fileToBase64, recognizeOnDevice } from '../services/ocr';
import { getSettings, subscribeSettings, updateSettings } from '../config';
import { pendingCount } from '../pipeline/queue';
import { subscribeHistory } from '../state/history';
import { camera, radius, space, TOUCH, type, useTheme } from '../theme';

interface Props {
  navigation: any;
}

/** Bouton rond posé sur l'image de la caméra */
const ChromeButton: React.FC<{ icon: any; label: string; onPress: () => void; selected?: boolean }> = ({
  icon: Icon,
  label,
  onPress,
  selected,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={selected !== undefined ? { checked: selected } : undefined}
    style={[styles.chromeButton, selected && { backgroundColor: 'rgba(255,255,255,0.9)' }]}
    android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: true, radius: TOUCH / 2 }}>
    <Icon size={22} color={selected ? '#14161C' : camera.text} strokeWidth={2} />
  </Pressable>
);

/** Zone de la photo (en pixels) qui correspond au cadre affiché, l'aperçu étant en mode « cover » */
function sensorCrop(pw: number, ph: number, sw: number, sh: number, box: { x: number; y: number; width: number; height: number }) {
  const scale = Math.max(sw / pw, sh / ph);
  const offX = (pw - sw / scale) / 2;
  const offY = (ph - sh / scale) / 2;
  const x = Math.max(0, Math.round(offX + box.x / scale));
  const y = Math.max(0, Math.round(offY + box.y / scale));
  return { x, y, width: Math.min(pw - x, Math.round(box.width / scale)), height: Math.min(ph - y, Math.round(box.height / scale)) };
}

export const CameraScannerScreen: React.FC<Props> = ({ navigation }) => {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  // ~2 Mpx suffisent pour une formule et gardent l'image légère pour l'OCR
  const format = useCameraFormat(device, [{ photoResolution: { width: 1920, height: 1080 } }]);
  const cameraRef = useRef<Camera>(null);

  const [torch, setTorch] = useState<'off' | 'on'>('off');
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanned, setScanned] = useState<{ latex: string; confidence: number | null } | null>(null);
  const [engine, setEngine] = useState<EngineStatus>(MathEngine.status);
  const [pending, setPending] = useState(0);
  const [settings, setSettings] = useState(getSettings());

  useEffect(() => MathEngine.subscribe(st => setEngine({ ...st })), []);
  useEffect(() => subscribeSettings(setSettings), []);
  useEffect(() => {
    const refresh = () =>
      pendingCount()
        .then(setPending)
        .catch(() => {});
    refresh();
    return subscribeHistory(refresh);
  }, []);

  const topLimit = insets.top + TOUCH + space.xl + space.xl;
  const bottomLimit = CONTROLS_HEIGHT + insets.bottom + space.lg;
  const boxWidth = Math.round(screenWidth * 0.86);
  const box = useResizableBox({
    screenWidth,
    screenHeight,
    initialWidth: boxWidth,
    initialHeight: 150,
    minWidth: 140,
    minHeight: 64,
    topLimit,
    bottomLimit,
  });

  const recognize = useCallback(async (base64: string, mime: string, crop?: FractionRect) => {
    const res = await recognizeOnDevice(base64, mime, crop);
    if (!res.latex) {
      throw new Error('Je n’ai pas reconnu de formule. Recadre une seule ligne, bien éclairée.');
    }
    setScanned({ latex: res.latex, confidence: res.confidence });
  }, []);

  const onError = (e: any) => showSnackbar(e?.message || 'Impossible de lire la formule.', { offset: CONTROLS_HEIGHT });

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isProcessing) {
      return;
    }
    try {
      setIsProcessing(true);
      setScanned(null);
      if (!getSettings().cameraTipSeen) {
        updateSettings({ cameraTipSeen: true });
      }
      const photo: PhotoFile = await cameraRef.current.takePhoto({ flash: torch, enableShutterSound: false });
      const rect = box.getCropRect();
      // la photo peut être dans l'orientation du capteur (paysage) : on raisonne dans celle de l'écran
      const portraitScreen = screenHeight >= screenWidth;
      const portraitPhoto = photo.height >= photo.width;
      const [pw, ph] = portraitScreen === portraitPhoto ? [photo.width, photo.height] : [photo.height, photo.width];
      const crop = sensorCrop(pw, ph, screenWidth, screenHeight, rect);
      const frac: FractionRect = { x: crop.x / pw, y: crop.y / ph, width: crop.width / pw, height: crop.height / ph };
      await recognize(await fileToBase64(photo.path), 'image/jpeg', frac);
    } catch (e) {
      onError(e);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, torch, screenWidth, screenHeight, box, recognize]);

  const handlePickImage = async () => {
    try {
      const img = await ImageCropPicker.openPicker({
        mediaType: 'photo',
        cropping: true,
        freeStyleCropEnabled: true,
        cropperToolbarTitle: 'Recadre la formule',
        cropperActiveWidgetColor: c.primary,
        includeBase64: true,
        compressImageMaxWidth: 1600,
        compressImageMaxHeight: 1600,
      });
      setIsProcessing(true);
      setScanned(null);
      await recognize(img.data ?? (await fileToBase64(img.path)), img.mime || 'image/jpeg');
    } catch (e: any) {
      if (e?.code !== 'E_PICKER_CANCELLED') {
        onError(e);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const openCalculator = (initialLatex?: string) => navigation.navigate('Calculator', { initialLatex: initialLatex || '' });

  if (!hasPermission || !device) {
    return (
      <View style={[styles.permission, { backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
        <View style={[styles.permissionIcon, { backgroundColor: c.primaryContainer }]}>
          <CameraIcon size={32} color={c.onPrimaryContainer} strokeWidth={2} />
        </View>
        <Text style={[type.headline, styles.center, { color: c.text }]}>
          {device ? 'Photographie tes exercices' : 'Pas de caméra disponible'}
        </Text>
        <Text style={[type.body, styles.center, { color: c.textMuted }]}>
          {device
            ? 'L’app a besoin de la caméra pour lire une formule. La photo reste sur ton téléphone.'
            : 'Tu peux saisir la formule avec la calculatrice ou choisir une image dans la galerie.'}
        </Text>
        <View style={styles.permissionActions}>
          {device ? <Button label="Autoriser la caméra" onPress={requestPermission} /> : null}
          <Button label="Ouvrir la calculatrice" icon={Calculator} variant={device ? 'text' : 'filled'} onPress={() => openCalculator()} />
          {!device ? <Button label="Choisir une image" variant="text" onPress={handlePickImage} /> : null}
        </View>
      </View>
    );
  }

  const cardBottom = CONTROLS_HEIGHT + insets.bottom + space.sm;
  const ocrNotice =
    engine.ocr === 'error'
      ? 'Lecture des photos indisponible : la calculatrice reste utilisable.'
      : engine.ocr !== 'ready'
        ? 'Préparation de la lecture des formules…'
        : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={focused}
        photo
        torch={torch}
        enableZoomGesture
      />
      <CameraOverlayMask
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        boxX={box.boxX}
        boxY={box.boxY}
        boxWidth={box.boxWidth}
        boxHeight={box.boxHeight}
      />
      <ResizableBoundingBox
        animatedStyle={box.animatedBoxStyle}
        panBoxGesture={box.panBoxGesture}
        resizeTopLeftGesture={box.resizeTopLeftGesture}
        resizeTopRightGesture={box.resizeTopRightGesture}
        resizeBottomLeftGesture={box.resizeBottomLeftGesture}
        resizeBottomRightGesture={box.resizeBottomRightGesture}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <ChromeButton
          icon={torch === 'on' ? Zap : ZapOff}
          label={torch === 'on' ? 'Éteindre la lampe' : 'Allumer la lampe'}
          selected={torch === 'on'}
          onPress={() => setTorch(t => (t === 'on' ? 'off' : 'on'))}
        />
        <View style={styles.topCenter}>
          {pending > 0 ? (
            <Pressable style={styles.pill} onPress={() => navigation.navigate('History')} accessibilityRole="button">
              <CloudOff size={16} color={camera.text} />
              <Text style={[type.caption, { color: camera.text }]}>
                {pending === 1 ? '1 question en attente du réseau' : `${pending} questions en attente du réseau`}
              </Text>
            </Pressable>
          ) : !settings.cameraTipSeen && !scanned && !isProcessing ? (
            <View style={styles.pill}>
              <Text style={[type.caption, { color: camera.text }]}>Cadre une seule formule, puis appuie sur le bouton</Text>
            </View>
          ) : ocrNotice ? (
            <View style={styles.pill}>
              <Text style={[type.caption, { color: camera.text }]}>{ocrNotice}</Text>
            </View>
          ) : null}
        </View>
        <ChromeButton icon={History} label="Historique" onPress={() => navigation.navigate('History')} />
        <ChromeButton icon={Settings} label="Réglages" onPress={() => navigation.navigate('Settings')} />
      </View>

      <ScannedFormulaCard
        latex={scanned?.latex ?? ''}
        isRecognizing={isProcessing}
        confidence={scanned?.confidence ?? null}
        threshold={settings.ocrMinConfidence}
        bottom={cardBottom}
        onEdit={latex => openCalculator(latex)}
        onSolve={latex => navigation.navigate('Solution', { latex, ocrConfidence: scanned?.confidence ?? null })}
        onDismiss={() => setScanned(null)}
      />

      <CameraControls
        onCapture={handleCapture}
        onPickImage={handlePickImage}
        onOpenCalculator={() => openCalculator()}
        isProcessing={isProcessing}
        disabled={engine.ocr === 'error'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.sm,
    zIndex: 50,
  },
  topCenter: { flex: 1, alignItems: 'center' },
  chromeButton: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: camera.chrome,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 32,
    borderRadius: radius.full,
    backgroundColor: camera.chromeStrong,
  },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxl, gap: space.md },
  permissionIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  permissionActions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xl },
  center: { textAlign: 'center' },
});
