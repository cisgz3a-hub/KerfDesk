import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createRect } from '../../../src/core/scene/SceneObject';

/**
 * 100 small rectangles on a 10×10 grid (300×300 mm canvas).
 * Perf regression guard — not snapshot-tested (output is huge and order-sensitive).
 */
export function makeLargeScene(): Scene {
  const scene = createScene(300, 300, 'large-scene fixture');
  const cutLayer = scene.layers[0];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const x = 10 + col * 30;
      const y = 10 + row * 30;
      scene.objects.push(createRect(cutLayer.id, x, y, 20, 15, `R${row}-${col}`));
    }
  }
  return scene;
}
