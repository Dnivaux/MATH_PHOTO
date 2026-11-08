import { useEffect, useMemo, useState } from 'react';
import { Camera, CameraDevice, getCameraDevice } from 'react-native-vision-camera';

/**
 * Caméra arrière. useCameraDevice s'abonne après le premier rendu : sur un téléphone rapide, la liste arrive
 * avant, l'événement est perdu et la caméra reste absente. On relit donc la liste juste après l'abonnement.
 */
export function useBackCamera(): CameraDevice | undefined {
  const [devices, setDevices] = useState(() => Camera.getAvailableCameraDevices());

  useEffect(() => {
    const listener = Camera.addCameraDevicesChangedListener(setDevices);
    setDevices(Camera.getAvailableCameraDevices());
    return () => listener.remove();
  }, []);

  return useMemo(() => getCameraDevice(devices, 'back'), [devices]);
}
