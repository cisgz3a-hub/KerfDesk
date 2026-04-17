import { createLayer } from '../../../src/core/scene/Layer';
import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { createEllipse, createLine, createRect } from '../../../src/core/scene/SceneObject';
import { makeTextObject } from '../helpers/textFixtureObject';

/** Cut rect + engrave ellipse + score line + Inter text on cut — exercises layer ordering. */
export function makeMixedScene(): Scene {
  const scene = createScene(200, 150, 'mixed-scene fixture');
  const cut = scene.layers[0];
  const engrave = createLayer(1, 'engrave', 'Engrave');
  const score = createLayer(2, 'score', 'Score');
  scene.layers.push(engrave, score);

  scene.objects.push(
    createRect(cut.id, 20, 20, 40, 20, 'Cut box'),
    createEllipse(engrave.id, 100, 70, 30, 20, 'Engrave oval'),
    createLine(score.id, 20, 130, 180, 130, 'Fold'),
    makeTextObject(cut.id, 30, 100, {
      text: 'MIX',
      fontFamily: 'Inter',
      fontSize: 15,
      bold: false,
      italic: false,
    }),
  );
  return scene;
}
