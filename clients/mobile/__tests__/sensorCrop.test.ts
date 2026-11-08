import { sensorCrop } from '../src/components/camera/sensorCrop';

// émulateur : aperçu 411,4 x 866,3 dp (barre d'état comprise), photo 1080 x 1920, cadre par défaut
const VIEW = { width: 411.43, height: 866.29 };
const BOX = { x: 28.6, y: 278.9, width: 353.9, height: 150 };

describe('sensorCrop', () => {
  it('lit la zone de la photo affichée dans le cadre', () => {
    expect(sensorCrop(1080, 1920, VIEW.width, VIEW.height, BOX)).toEqual({ x: 147, y: 618, width: 784, height: 332 });
  });

  it('avec la hauteur de fenêtre, sans la barre d’état, la zone serait décalée vers le bas', () => {
    const wrong = sensorCrop(1080, 1920, VIEW.width, 817.5, BOX);
    const right = sensorCrop(1080, 1920, VIEW.width, VIEW.height, BOX);
    expect(wrong.y - right.y).toBeGreaterThan(30);
    expect(wrong.height).toBeGreaterThan(right.height);
  });

  it('coupe le haut et le bas d’une photo plus haute que l’aperçu', () => {
    // aperçu carré : toute la largeur de la photo est visible, le haut et le bas sont hors champ
    const c = sensorCrop(900, 1200, 900, 900, { x: 0, y: 0, width: 900, height: 900 });
    expect(c).toEqual({ x: 0, y: 150, width: 900, height: 900 });
  });

  it('ne sort jamais de la photo', () => {
    const c = sensorCrop(1080, 1920, VIEW.width, VIEW.height, { x: 0, y: 800, width: VIEW.width, height: 200 });
    expect(c.y + c.height).toBeLessThanOrEqual(1920);
    expect(c.x + c.width).toBeLessThanOrEqual(1080);
  });
});
