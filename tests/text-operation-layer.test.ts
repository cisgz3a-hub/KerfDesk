import { createScene, type Scene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { IDENTITY_MATRIX } from '../src/core/types';
import { type SceneObject } from '../src/core/scene/SceneObject';
import {
  assignObjectsToTextOperationLayer,
  resolveTextOperationLayer,
  textOperationModeForObject,
  type TextOperationMode,
} from '../src/ui/scene/TextOperationLayer';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeTextObject(id: string, layerId: string): SceneObject {
  return {
    id,
    type: 'text',
    name: id,
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: {
      type: 'text',
      text: id,
      fontSize: 20,
      fontFamily: 'Arial',
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function layerByMode(scene: Scene, mode: TextOperationMode) {
  return scene.layers.find(layer => layer.settings.mode === mode);
}

{
  const scene = createScene(400, 400, 'default cut');
  const cutLayerId = scene.activeLayerId;

  const resolved = resolveTextOperationLayer(scene, 'engrave');

  assert(resolved.layerCreated === true, 'engrave layer is created when the scene only has cut');
  assert(resolved.scene.layers.length === 2, 'engrave layer is appended');
  assert(resolved.layerId !== cutLayerId, 'engrave layer does not reuse the default cut layer');
  assert(layerByMode(resolved.scene, 'engrave')?.id === resolved.layerId, 'resolved layer is engrave');
  assert(resolved.scene.activeLayerId === resolved.layerId, 'new text layer becomes active');
}

{
  const scene = createScene(400, 400, 'existing engrave');
  const engraveLayer = createLayer(1, 'engrave', 'Names');
  scene.layers = [...scene.layers, engraveLayer];

  const resolved = resolveTextOperationLayer(scene, 'engrave');

  assert(resolved.layerCreated === false, 'existing engrave layer is reused');
  assert(resolved.scene.layers.length === 2, 'reusing a layer does not add another layer');
  assert(resolved.layerId === engraveLayer.id, 'resolved id is the existing engrave layer');
  assert(resolved.scene.activeLayerId === engraveLayer.id, 'existing engrave layer becomes active');
}

{
  const scene = createScene(400, 400, 'cut target');
  const resolved = resolveTextOperationLayer(scene, 'cut');

  assert(resolved.layerCreated === false, 'default cut layer is reused for cut text');
  assert(resolved.layerId === scene.layers[0].id, 'cut text resolves to the existing cut layer');
  assert(resolved.scene.activeLayerId === scene.layers[0].id, 'cut layer remains active');
}

{
  const scene = createScene(400, 400, 'object mode');
  const scoreLayer = createLayer(1, 'score', 'Score');
  scene.layers = [...scene.layers, scoreLayer];
  const cutText = makeTextObject('cut-name', scene.layers[0].id);
  const scoreText = makeTextObject('score-name', scoreLayer.id);

  assert(textOperationModeForObject(scene, cutText) === 'cut', 'cut-layer text edits as cut');
  assert(textOperationModeForObject(scene, scoreText) === 'engrave', 'non cut/engrave text edits default to engrave');
  assert(textOperationModeForObject(scene, null) === 'engrave', 'missing source defaults to engrave');
}

{
  const scene = createScene(400, 400, 'variable names');
  const objects = [
    makeTextObject('name-1', scene.activeLayerId),
    makeTextObject('name-2', scene.activeLayerId),
  ];

  const assigned = assignObjectsToTextOperationLayer(scene, objects, 'engrave');

  assert(assigned.scene.activeLayerId === assigned.layerId, 'assigned operation layer becomes active');
  assert(assigned.objects.every(obj => obj.layerId === assigned.layerId), 'all generated names move to operation layer');
  assert(assigned.objects.every(obj => obj._bounds === null && obj._worldTransform === null), 'assigned objects invalidate cached geometry');
  assert(objects.every(obj => obj.layerId === scene.activeLayerId), 'original generated objects are not mutated');
}
