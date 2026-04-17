import { createScene, type Scene } from '../../../src/core/scene/Scene';
import { makeTextObject } from '../helpers/textFixtureObject';

/** Text "HELLO" in bundled Inter (opentype outline path). Requires `prepareSceneForCompile`. */
export function makeTextBundledInterScene(): Scene {
  const scene = createScene(200, 150, 'text-bundled-inter fixture');
  const cut = scene.layers[0];
  scene.objects.push(
    makeTextObject(cut.id, 30, 40, {
      text: 'HELLO',
      fontSize: 20,
      fontFamily: 'Inter',
      bold: false,
      italic: false,
    }),
  );
  return scene;
}
