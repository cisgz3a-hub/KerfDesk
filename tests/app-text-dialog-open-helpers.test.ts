import fs from 'node:fs';
import path from 'node:path';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import type { SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8');
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

void (async () => {
  console.log('\n=== T2-6 Phase 3ar app text dialog open helpers ===\n');

  const helperPath = path.join(process.cwd(), 'src', 'ui', 'components', 'app', 'appTextDialogOpenHelpers.ts');
  assert(fs.existsSync(helperPath), 'T2-6 Phase 3ar text dialog open helper exists');

  const {
    buildTextEditDialogRequest,
    buildTextPlacementDialogRequest,
  } = await import('../src/ui/components/app/appTextDialogOpenHelpers');

  {
    const result = buildTextPlacementDialogRequest({ x: 17, y: 23 });
    assert(result.editingTextId === null, 'new placed text clears editing id');
    assert(result.textOperationMode === 'engrave', 'new placed text defaults to engrave');
    assert(result.textPlacementPt.x === 17 && result.textPlacementPt.y === 23, 'new placed text keeps requested world point');
    assert(result.showDialog === true, 'new placed text opens the text dialog');
  }

  {
    const scene = createScene(400, 400, 'cut text edit');
    const cutText = makeTextObject('cut-name', scene.activeLayerId);
    const result = buildTextEditDialogRequest(scene, cutText);

    assert(result.textOperationMode === 'cut', 'editing cut-layer text preselects cut');
    assert(result.textPlacementPt === null, 'editing text clears placement point');
    assert(result.selectionAfter.has(cutText.id), 'editing text selects the edited object');
  }

  {
    const scene: Scene = createScene(400, 400, 'score text edit');
    const scoreLayer = createLayer(1, 'score', 'Score');
    scene.layers = [...scene.layers, scoreLayer];
    const scoreText = makeTextObject('score-name', scoreLayer.id);
    const result = buildTextEditDialogRequest(scene, scoreText);

    assert(result.textOperationMode === 'engrave', 'editing non cut/engrave text defaults to engrave');
    assert(result.selectionAfter.has(scoreText.id), 'editing fallback-mode text still selects the edited object');
  }

  const appSource = readSource('src', 'ui', 'components', 'App.tsx');
  const helperSource = readSource('src', 'ui', 'components', 'app', 'appTextDialogOpenHelpers.ts');

  assert(appSource.includes('buildTextPlacementDialogRequest'), 'App delegates text placement opening to the helper');
  assert(appSource.includes('buildTextEditDialogRequest'), 'App delegates text edit opening to the helper');
  assert(!appSource.includes('textOperationModeForObject(scene, obj)'),
    'App no longer derives edit text operation inline');
  assert(helperSource.includes('T2-6 Phase 3ar'), 'helper carries the T2-6 Phase 3ar marker');

  console.log('Text dialog open/edit decisions are extracted from App.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
