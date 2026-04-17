import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createRect } from '../../../src/core/scene/SceneObject';

/** Same geometry as rectangle-cut; cut layer `passes: 3`. */
export function makeMultiPassCutScene(): Scene {
  const scene = createScene(200, 150, 'multi-pass-cut fixture');
  const cut = scene.layers[0];
  cut.settings.passes = 3;
  scene.objects.push(createRect(cut.id, 30, 30, 40, 20, 'Rect'));
  return scene;
}
