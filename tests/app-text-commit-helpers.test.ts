import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import {
  buildTextDialogSceneCommit,
  textDialogObjectName,
} from '../src/ui/components/app/appTextCommitHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

function baseScene(): Scene {
  return createScene(400, 300, 'Text helper test');
}

function textObject(id: string, layerId: string, text = 'Old'): SceneObject {
  return {
    id,
    type: 'text',
    name: text,
    layerId,
    parentId: null,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 34 },
    geometry: {
      type: 'text',
      text,
      fontSize: 10,
      fontFamily: 'Inter',
      bold: false,
      italic: false,
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    _worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 34 },
  };
}

console.log('\n=== T2-6 Phase 3z app text commit helpers ===\n');

assert(textDialogObjectName('Short') === 'Short', 'short text name is unchanged');
assert(
  textDialogObjectName('1234567890123456789012345') === '12345678901234567890...',
  'long text name is truncated to 20 chars plus ellipsis',
);

{
  const scene = baseScene();
  const result = buildTextDialogSceneCommit({
    scene,
    newTextId: 'text-new',
    draft: {
      textInput: '  ',
      textFont: 'Inter',
      textSize: 12,
      textBold: false,
      textItalic: false,
      textOperationMode: 'engrave',
      editingTextId: null,
      textPlacementPt: null,
    },
  });
  assert(result === null, 'blank text input produces no commit result');
}

{
  const scene = baseScene();
  const result = buildTextDialogSceneCommit({
    scene,
    newTextId: 'text-new',
    draft: {
      textInput: 'Johann',
      textFont: 'Inter',
      textSize: 18,
      textBold: true,
      textItalic: false,
      textOperationMode: 'engrave',
      editingTextId: null,
      textPlacementPt: null,
    },
  });
  assert(result != null, 'new text result returned');
  assert(result.action === 'text-add', 'new text uses text-add action');
  assert(result.placedNewText === true, 'new text marks placedNewText');
  assert(result.selectionAfter.has('text-new'), 'new text selects the new object');
  const added = result.scene.objects.find(o => o.id === 'text-new');
  assert(added?.geometry.type === 'text', 'new object is text');
  assert(added.name === 'Johann', 'new object name follows input');
  assert(added.transform.tx === 170 && added.transform.ty === 140, 'new object uses center fallback placement');
  const layer = result.scene.layers.find(l => l.id === added.layerId);
  assert(layer?.settings.mode === 'engrave', 'new text defaults to engrave layer');
  assert(result.scene.activeLayerId === added.layerId, 'new text activates its operation layer');
}

{
  const scene = {
    ...baseScene(),
    layers: [createLayer(0, 'cut', 'Cut'), createLayer(1, 'engrave', 'Engrave')],
  };
  scene.activeLayerId = scene.layers[0].id;
  const result = buildTextDialogSceneCommit({
    scene,
    newTextId: 'text-new',
    draft: {
      textInput: 'Corner',
      textFont: 'Arial',
      textSize: 14,
      textBold: false,
      textItalic: true,
      textOperationMode: 'cut',
      editingTextId: null,
      textPlacementPt: { x: 25, y: 35 },
    },
  });
  assert(result != null, 'cut text result returned');
  const added = result.scene.objects.find(o => o.id === 'text-new');
  assert(added?.layerId === scene.layers[0].id, 'cut text reuses existing cut layer');
  assert(added.transform.tx === 25 && added.transform.ty === 35, 'explicit placement is preserved');
  assert(added.geometry.type === 'text' && added.geometry.italic === true, 'style flags are copied');
}

{
  const cut = createLayer(0, 'cut', 'Cut');
  const engrave = createLayer(1, 'engrave', 'Engrave');
  const old = textObject('old-text', cut.id);
  const scene: Scene = {
    ...baseScene(),
    layers: [cut, engrave],
    activeLayerId: cut.id,
    objects: [old],
  };
  const result = buildTextDialogSceneCommit({
    scene,
    newTextId: 'unused',
    draft: {
      textInput: 'Updated',
      textFont: 'Inter',
      textSize: 22,
      textBold: true,
      textItalic: true,
      textOperationMode: 'engrave',
      editingTextId: 'old-text',
      textPlacementPt: { x: 99, y: 99 },
    },
  });
  assert(result != null, 'edit text result returned');
  assert(result.action === 'text-edit', 'editing uses text-edit action');
  assert(result.placedNewText === false, 'editing does not mark placedNewText');
  assert(result.selectionAfter.has('old-text'), 'editing keeps edited object selected');
  const edited = result.scene.objects.find(o => o.id === 'old-text');
  assert(edited?.layerId === engrave.id, 'editing can move text to engrave layer');
  assert(edited.transform.tx === old.transform.tx && edited.transform.ty === old.transform.ty, 'editing preserves transform');
  assert(edited._bounds === null && edited._worldTransform === null, 'editing invalidates object caches');
  assert(edited.geometry.type === 'text' && edited.geometry.fontSize === 22, 'editing updates text style');
}

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appTextCommitHelpers.ts'), 'utf8');

assert(
  appSource.includes("buildTextDialogSceneCommit"),
  'App imports and uses buildTextDialogSceneCommit',
);
assert(
  !appSource.includes("resolveTextOperationLayer(scene, dialogs.textOperationMode)"),
  'App no longer resolves text operation layers inline',
);
assert(
  !appSource.includes("geometry: {\\n          type: 'text'"),
  'App no longer builds new text geometry inline',
);
assert(
  helperSource.includes('T2-6 Phase 3z'),
  'appTextCommitHelpers carries the T2-6 Phase 3z marker',
);

console.log('Text dialog scene mutation logic is extracted from App.');
