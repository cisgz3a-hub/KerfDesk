import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createEllipse } from '../../../src/core/scene/SceneObject';

/** Ellipse on cut layer — tessellated closed polyline. */
export function makeCircleCutScene(): Scene {
  const scene = createScene(200, 150, 'circle-cut fixture');
  const cut = scene.layers[0];
  scene.objects.push(createEllipse(cut.id, 100, 75, 40, 30, 'Oval'));
  return scene;
}
