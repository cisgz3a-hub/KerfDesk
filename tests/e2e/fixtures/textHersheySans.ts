import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { makeTextObject } from '../helpers/textFixtureObject';

/** Text "HELLO" in Hershey Sans (single-stroke path). Requires `prepareSceneForCompile`. */
export function makeTextHersheySansScene(): Scene {
  const scene = createScene(200, 150, 'text-hershey-sans fixture');
  const cut = scene.layers[0];
  scene.objects.push(
    makeTextObject(cut.id, 30, 40, {
      text: 'HELLO',
      fontSize: 20,
      fontFamily: 'Hershey Sans',
      bold: false,
      italic: false,
    }),
  );
  return scene;
}
