import { createLayer } from '../../../src/core/scene/Layer';
import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createLine } from '../../../src/core/scene/SceneObject';

/** Single horizontal score line. */
export function makeScoreLineScene(): Scene {
  const scene = createScene(200, 150, 'score-line fixture');
  const score = createLayer(1, 'score', 'Score');
  scene.layers.push(score);
  scene.objects.push(createLine(score.id, 20, 50, 180, 50, 'Score'));
  return scene;
}
