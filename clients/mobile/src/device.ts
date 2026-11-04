/**
 * Capacités de l'appareil : le dossier recommande le mode léger sous 6 Go de RAM.
 */
import DeviceInfo from 'react-native-device-info';
import { getSettings, InstallMode } from './config';

const GB = 1024 ** 3;
export const MIN_RAM_COMPLET = 6 * GB * 0.92; // marge : un téléphone « 6 Go » annonce un peu moins

let totalRam: number | null = null;

export async function loadDeviceInfo(): Promise<void> {
  try {
    totalRam = await DeviceInfo.getTotalMemory();
  } catch {
    totalRam = null;
  }
}

export function ramGb(): number | null {
  return totalRam ? Math.round((totalRam / GB) * 10) / 10 : null;
}

export function recommendedMode(): 'complet' | 'leger' {
  return totalRam !== null && totalRam < MIN_RAM_COMPLET ? 'leger' : 'complet';
}

/** Mode effectif : choix de l'utilisateur, ou recommandation selon la RAM */
export function effectiveMode(mode: InstallMode = getSettings().mode): 'complet' | 'leger' {
  return mode === 'auto' ? recommendedMode() : mode;
}
