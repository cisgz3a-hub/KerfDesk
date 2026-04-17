import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createRect } from '../../../src/core/scene/SceneObject';

/**
 * Fixture: a single 40×20mm rectangle on the default Cut layer,
 * positioned at (30, 30) on a 200×150mm canvas. Cut at default
 * settings.
 *
 * Why this fixture: simplest possible non-trivial job. Exercises
 * scene construction, cut-mode G-code generation, bounds, and
 * machine transform. If this snapshot ever changes unexpectedly,
 * something core has moved.
 */
export function makeRectangleCutScene(): Scene {
  const scene = createScene(200, 150, 'rectangle-cut fixture');
  const cutLayer = scene.layers[0];
  const rect = createRect(cutLayer.id, 30, 30, 40, 20, 'Rect');
  scene.objects.push(rect);
  return scene;
}
