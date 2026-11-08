/** Zone de la photo (en pixels) qui correspond au cadre affiché, l'aperçu étant en mode « cover » */
export function sensorCrop(pw: number, ph: number, sw: number, sh: number, box: { x: number; y: number; width: number; height: number }) {
  const scale = Math.max(sw / pw, sh / ph);
  const offX = (pw - sw / scale) / 2;
  const offY = (ph - sh / scale) / 2;
  const x = Math.max(0, Math.round(offX + box.x / scale));
  const y = Math.max(0, Math.round(offY + box.y / scale));
  return { x, y, width: Math.min(pw - x, Math.round(box.width / scale)), height: Math.min(ph - y, Math.round(box.height / scale)) };
}
