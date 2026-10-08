import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  useWindowDimensions,
  Alert,
  StatusBar,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  PhotoFile,
} from 'react-native-vision-camera';
import { CameraOverlayMask } from '../components/camera/CameraOverlayMask';
import { ResizableBoundingBox } from '../components/camera/ResizableBoundingBox';
import { CameraControls } from '../components/camera/CameraControls';
import { ScannedFormulaCard } from '../components/math/ScannedFormulaCard';
import { useResizableBox } from '../hooks/useResizableBox';
import ImageCropPicker from 'react-native-image-crop-picker';
import { TouchableOpacity } from 'react-native';
import { fileToBase64, recognizeOnDevice } from '../services/ocr/onDeviceOcr';
import { EngineStatus, FractionRect, MathEngine } from '../engine/MathEngine';

interface CameraScannerScreenProps {
  navigation: any;
}

export const CameraScannerScreen: React.FC<CameraScannerScreenProps> = ({ navigation }) => {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  // ~2 Mpx suffisent pour une formule et gardent l'image légère pour l'OCR
  const format = useCameraFormat(device, [{ photoResolution: { width: 1920, height: 1080 } }]);
  const cameraRef = useRef<Camera>(null);

  // States
  const [torch, setTorch] = useState<'off' | 'on'>('off');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [scannedLatex, setScannedLatex] = useState<string>('');
  const [ocrInfo, setOcrInfo] = useState<{ confidence: number | null; model: string; ms: number } | null>(null);
  const [engine, setEngine] = useState<EngineStatus>(MathEngine.status);

  useEffect(() => MathEngine.subscribe(st => setEngine({ ...st })), []);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // Viewfinder bounding box management (60 fps Worklet driven)
  const {
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    animatedBoxStyle,
    panBoxGesture,
    resizeTopLeftGesture,
    resizeTopRightGesture,
    resizeBottomLeftGesture,
    resizeBottomRightGesture,
    getCropRect,
  } = useResizableBox({
    screenWidth,
    screenHeight,
    initialWidth: Math.min(320, screenWidth - 48),
    initialHeight: 140,
    minWidth: 160,
    minHeight: 70,
  });

  // Calculate pixel-accurate crop coordinates from screen viewport to photo resolution
  const computeSensorCropRect = (
    photoWidth: number,
    photoHeight: number,
    screenWidth: number,
    screenHeight: number,
    box: { x: number; y: number; width: number; height: number }
  ) => {
    // Camera preview typically uses "cover" scaling
    const scale = Math.max(screenWidth / photoWidth, screenHeight / photoHeight);
    const visibleWidthOnSensor = screenWidth / scale;
    const visibleHeightOnSensor = screenHeight / scale;

    const sensorOffsetX = (photoWidth - visibleWidthOnSensor) / 2;
    const sensorOffsetY = (photoHeight - visibleHeightOnSensor) / 2;

    const cropX = Math.round(sensorOffsetX + (box.x / scale));
    const cropY = Math.round(sensorOffsetY + (box.y / scale));
    const cropWidth = Math.round(box.width / scale);
    const cropHeight = Math.round(box.height / scale);

    return {
      x: Math.max(0, cropX),
      y: Math.max(0, cropY),
      width: Math.min(photoWidth - cropX, cropWidth),
      height: Math.min(photoHeight - cropY, cropHeight),
    };
  };

  /** OCR embarqué (Texo, sur le téléphone) */
  const recognize = useCallback(async (base64: string, mime: string, crop?: FractionRect) => {
    const res = await recognizeOnDevice(base64, mime, crop);
    setOcrInfo({
      confidence: null,
      model: `OCR sur le téléphone (${res.source === 'apk' ? 'modèle embarqué' : 'modèle téléchargé'})`,
      ms: res.ms,
    });
    setScannedLatex(res.latex);
    if (!res.latex) throw new Error('Aucune formule reconnue');
  }, []);

  // Capture & Run OCR Pipeline
  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isProcessing) return;

    try {
      setIsProcessing(true);

      // 1. Take high-resolution photo with zero shutter lag
      const photo: PhotoFile = await cameraRef.current.takePhoto({
        flash: torch,
        enableShutterSound: false,
      });

      const currentBox = getCropRect();
      // Les dimensions renvoyées peuvent être celles du capteur (paysage) alors que
      // l'écran est en portrait : le serveur redresse l'image (EXIF) avant de recadrer,
      // donc on raisonne dans l'orientation de l'écran.
      const portraitScreen = screenHeight >= screenWidth;
      const portraitPhoto = photo.height >= photo.width;
      const [pw, ph] = portraitScreen === portraitPhoto ? [photo.width, photo.height] : [photo.height, photo.width];
      const crop = computeSensorCropRect(
        pw,
        ph,
        screenWidth,
        screenHeight,
        currentBox
      );

      const frac: FractionRect = { x: crop.x / pw, y: crop.y / ph, width: crop.width / pw, height: crop.height / ph };
      const base64 = await fileToBase64(photo.path);
      await recognize(base64, 'image/jpeg', frac);
    } catch (error: any) {
      console.error('[Camera] Capture/Inference failed:', error);
      Alert.alert('Erreur de scan', error.message || 'Impossible de lire la formule.');
    } finally {
      setIsProcessing(false);
    }
  }, [cameraRef, isProcessing, torch, screenWidth, screenHeight, getCropRect, recognize]);

  const handleToggleTorch = () => {
    setTorch((prev) => (prev === 'on' ? 'off' : 'on'));
  };

  const handlePickImage = async () => {
    try {
      const img = await ImageCropPicker.openPicker({
        mediaType: 'photo',
        cropping: true,
        freeStyleCropEnabled: true,
        cropperToolbarTitle: 'Recadrer la formule',
        includeBase64: true,
        compressImageMaxWidth: 1600,
        compressImageMaxHeight: 1600,
      });
      setIsProcessing(true);
      await recognize(img.data ?? (await fileToBase64(img.path)), img.mime || 'image/jpeg');
    } catch (error: any) {
      if (error?.code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Erreur de scan', error?.message || 'Impossible de lire la formule.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenCalculator = (initialLatex?: string) => {
    navigation.navigate('Calculator', { initialLatex: initialLatex || '' });
  };

  const handleSolve = (latex: string) => {
    navigation.navigate('Solution', { latex });
  };

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Autorisation Caméra Requise</Text>
        <TouchableOpacity onPress={requestPermission} style={{ marginTop: 16 }}>
          <Text style={[styles.permissionText, { color: '#FF3B30' }]}>Autoriser</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleOpenCalculator()} style={{ marginTop: 16 }}>
          <Text style={[styles.permissionText, { color: '#8E8E93' }]}>Ouvrir la calculatrice</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Aucun capteur caméra arrière détecté.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Camera Live Preview */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        photo={true}
        torch={torch}
        enableZoomGesture={true}
      />

      {/* Darkened Mask with Viewfinder Cutout Hole (60fps Reanimated) */}
      <CameraOverlayMask
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        boxX={boxX}
        boxY={boxY}
        boxWidth={boxWidth}
        boxHeight={boxHeight}
      />

      {/* Interactive Resizable Bounding Box */}
      <ResizableBoundingBox
        animatedStyle={animatedBoxStyle}
        panBoxGesture={panBoxGesture}
        resizeTopLeftGesture={resizeTopLeftGesture}
        resizeTopRightGesture={resizeTopRightGesture}
        resizeBottomLeftGesture={resizeBottomLeftGesture}
        resizeBottomRightGesture={resizeBottomRightGesture}
      />

      {/* Floating Card displaying scanned LaTeX with KaTeX and Edit Action */}
      <ScannedFormulaCard
        latex={scannedLatex}
        isRecognizing={isProcessing}
        info={ocrInfo}
        onEditInCalculator={(formula) => handleOpenCalculator(formula)}
        onSolve={(formula) => handleSolve(formula)}
        onDismiss={() => setScannedLatex('')}
      />

      {engine.ocr !== 'ready' && (
        <View style={styles.ocrBanner} pointerEvents="none">
          <Text style={styles.ocrBannerText}>
            {engine.ocr === 'error'
              ? 'OCR indisponible (voir Réglages)'
              : `Chargement de l'OCR${engine.ocrProgress ? ` ${engine.ocrProgress} %` : '…'}`}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.settingsButton} onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.settingsText}>⚙︎</Text>
      </TouchableOpacity>

      {/* Shutter & Controls Bottom Bar */}
      <CameraControls
        torchOn={torch === 'on'}
        onToggleTorch={handleToggleTorch}
        onCapture={handleCapture}
        onPickImage={handlePickImage}
        onOpenCalculator={() => handleOpenCalculator()}
        isProcessing={isProcessing}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  settingsButton: {
    position: 'absolute',
    top: 44,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  settingsText: { color: '#FFF', fontSize: 20 },
  ocrBanner: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    zIndex: 45,
  },
  ocrBannerText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#121214',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionText: {
    color: '#FFF',
    fontSize: 16,
    textAlign: 'center',
  },
});
