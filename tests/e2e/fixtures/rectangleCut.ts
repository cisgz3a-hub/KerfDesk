import { createLayer } from '../../../src/core/scene/Layer';
import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createRect } from '../../../src/core/scene/SceneObject';

export function createRectangleCutFixture(): Scene {
  const scene = createScene(400, 300, 'E2E Rectangle Cut');
  const cutLayer = createLayer(0, 'cut', 'Cut');
  cutLayer.settings.power.max = 80;
  cutLayer.settings.speed = 400;
  cutLayer.settings.passes = 1;

  scene.layers = [cutLayer];
  scene.activeLayerId = cutLayer.id;

  const rect = createRect(cutLayer.id, 50, 50, 50, 30, 'Rectangle');
  scene.objects = [rect];
  return scene;
}
