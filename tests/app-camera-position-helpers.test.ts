import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { buildCameraPositionCommit } from '../src/ui/components/app/appCameraPositionHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function sceneWithObjects(): Scene {
  const layer = createLayer(0, 'cut', 'Cut');
  const first = createRect(layer.id, 10, 20, 5, 5, 'First');
  const second = createRect(layer.id, 40, 60, 5, 5, 'Second');
  const hidden = { ...createRect(layer.id, 1, 2, 5, 5, 'Hidden'), visible: false };
  return {
    ...createScene(400, 300, 'Camera helper test'),
    layers: [layer],
    activeLayerId: layer.id,
    objects: [first, second, hidden],
  };
}

console.log('\n=== T2-6 Phase 3ae app camera-position helpers ===\n');

{
  const scene = sceneWithObjects();
  const result = buildCameraPositionCommit(scene, new Set(), 100, 200);
  assert(result != null, 'empty selection with visible objects produces a commit');
  assert(result.action === 'camera-position', 'camera helper uses camera-position action');
  assert(result.scene !== scene, 'camera helper returns a new scene');
  assert(result.scene.objects[0].transform.tx === 100, 'first visible object anchors target X');
  assert(result.scene.objects[0].transform.ty === 200, 'first visible object anchors target Y');
  assert(result.scene.objects[1].transform.tx === 130, 'second object moves by the same delta X');
  assert(result.scene.objects[1].transform.ty === 240, 'second object moves by the same delta Y');
  assert(result.scene.objects[2].transform.tx === 91, 'hidden object also moves with whole-scene positioning');
  assert(result.scene.objects[2].transform.ty === 182, 'hidden object also moves with whole-scene positioning');
}

{
  const scene = sceneWithObjects();
  const selected = new Set([scene.objects[1].id]);
  const result = buildCameraPositionCommit(scene, selected, 80, 90);
  assert(result != null, 'selected object produces a commit');
  assert(result.scene.objects[0] === scene.objects[0], 'unselected object reference is preserved');
  assert(result.scene.objects[1].transform.tx === 80, 'selected object anchors target X');
  assert(result.scene.objects[1].transform.ty === 90, 'selected object anchors target Y');
  assert(result.scene.objects[2] === scene.objects[2], 'unselected hidden object reference is preserved');
}

{
  const scene = {
    ...sceneWithObjects(),
    objects: sceneWithObjects().objects.map(obj => ({ ...obj, visible: false })),
  };
  const result = buildCameraPositionCommit(scene, new Set(), 100, 200);
  assert(result === null, 'empty selection with no visible objects produces no commit');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appCameraPositionHelpers.ts'), 'utf8');

assert(
  appSource.includes('buildCameraPositionCommit'),
  'App imports and uses buildCameraPositionCommit',
);
assert(
  !appSource.includes('let minX = Infinity'),
  'App no longer carries camera-position minX scanning inline',
);
assert(
  !appSource.includes("handleSceneCommit(newScene, 'camera-position')"),
  'App no longer builds camera-position scenes inline',
);
assert(
  helperSource.includes('T2-6 Phase 3ae'),
  'appCameraPositionHelpers carries the T2-6 Phase 3ae marker',
);

console.log('Camera-position scene transaction building is extracted from App.');
