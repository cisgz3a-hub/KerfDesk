import { createLayer } from '../../../src/core/scene/Layer';
import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createRect } from '../../../src/core/scene/SceneObject';

/** 40×30mm rectangle on an engrave layer — fill / scanline raster output. */
export function makeEngraveFillScene(): Scene {
  const scene = createScene(200, 150, 'engrave-fill fixture');
  const engrave = createLayer(1, 'engrave', 'Engrave');
  scene.layers.push(engrave);
  scene.activeLayerId = engrave.id;
  scene.objects.push(createRect(engrave.id, 30, 30, 40, 30, 'Fill area'));
  return scene;
}
