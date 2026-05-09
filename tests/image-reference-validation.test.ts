/**
 * T3-75: validate indexeddb:// image references when loading projects.
 *
 * Run: npx tsx tests/image-reference-validation.test.ts
 */
import { readFileSync } from 'node:fs';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type ImageGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../src/core/types';
import {
  applyMissingImageReferenceState,
  formatMissingImageReferenceReport,
  isIndexedDbImageReference,
  validateAndAnnotateImageReferences,
  validateImageReferences,
} from '../src/io/ImageReferenceValidation';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

function makeImageObject(id: string, layerId: string, src: string): SceneObject {
  return {
    id,
    type: 'image',
    name: id,
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: {
      type: 'image',
      src,
      originalWidth: 96,
      originalHeight: 96,
      cropX: 0,
      cropY: 0,
      cropWidth: 96,
      cropHeight: 96,
    } as ImageGeometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function makeSceneWithImages(objects: SceneObject[]) {
  const scene = createScene(400, 300, 'image refs');
  const layer = createLayer(0, 'image', 'Photos');
  (layer as { id: string }).id = 'photos';
  scene.layers = [layer];
  scene.activeLayerId = 'photos';
  scene.objects = objects;
  return scene;
}

function fakeStore(presentIds: readonly string[]) {
  const present = new Set(presentIds);
  return {
    hasImage: async (id: string) => present.has(id),
  };
}

console.log('\n=== T3-75 image reference validation ===\n');

void (async () => {
  assert(isIndexedDbImageReference('indexeddb://img_123'), 'indexeddb image refs are detected');
  assert(!isIndexedDbImageReference('data:image/png;base64,abc'), 'data URI image refs are not treated as IndexedDB refs');
  assert(!isIndexedDbImageReference('https://example.test/image.png'), 'remote image refs are not checked on load');

  {
    const scene = makeSceneWithImages([
      makeImageObject('present', 'photos', 'indexeddb://img_present'),
    ]);
    const result = await validateImageReferences(scene, fakeStore(['img_present']));
    assert(result.missing.length === 0, 'present indexeddb image reports no missing references');
  }

  {
    const scene = makeSceneWithImages([
      makeImageObject('missing', 'photos', 'indexeddb://img_missing'),
    ]);
    const result = await validateImageReferences(scene, fakeStore([]));
    assert(result.missing.length === 1, 'deleted indexeddb image is reported as missing');
    assert(result.missing[0].objectId === 'missing', 'missing report includes object id');
    assert(result.missing[0].imageId === 'img_missing', 'missing report includes image id');
    assert(result.missing[0].layerName === 'Photos', 'missing report includes layer name');
  }

  {
    const scene = makeSceneWithImages([
      makeImageObject('inline', 'photos', 'data:image/png;base64,abc'),
    ]);
    const result = await validateImageReferences(scene, fakeStore([]));
    assert(result.missing.length === 0, 'data URI image is always considered resolvable');
  }

  {
    const scene = makeSceneWithImages([
      makeImageObject('missing', 'photos', 'indexeddb://img_missing'),
    ]);
    const result = await validateImageReferences(scene, {
      hasImage: async () => { throw new Error('IndexedDB unavailable'); },
    });
    assert(result.missing.length === 1, 'image-store lookup failures are reported as missing instead of aborting load');
  }

  {
    const scene = makeSceneWithImages([
      makeImageObject('missing', 'photos', 'indexeddb://img_missing'),
      makeImageObject('present', 'photos', 'indexeddb://img_present'),
    ]);
    const { scene: annotated, validation } = await validateAndAnnotateImageReferences(scene, fakeStore(['img_present']));
    assert(validation.missing.length === 1, 'validateAndAnnotateImageReferences returns validation result');
    const missing = annotated.objects.find(o => o.id === 'missing')?.geometry as ImageGeometry | undefined;
    const present = annotated.objects.find(o => o.id === 'present')?.geometry as ImageGeometry | undefined;
    assert(missing?.missingSource === true, 'missing image object is annotated for placeholder rendering');
    assert(missing?.missingSourceId === 'img_missing', 'missing image annotation preserves image id');
    assert(present?.missingSource !== true, 'present image object is not annotated');
    assert(scene.objects[0].geometry !== annotated.objects[0].geometry, 'annotation returns a new object geometry');
  }

  {
    const scene = makeSceneWithImages([
      makeImageObject('missing', 'photos', 'indexeddb://img_missing'),
    ]);
    const validation = await validateImageReferences(scene, fakeStore([]));
    const report = formatMissingImageReferenceReport(validation);
    assert(report.includes('1 image object'), 'report summarizes missing image count');
    assert(report.includes('Photos'), 'report names the affected layer');
    assert(report.includes('re-import'), 'report explains the recovery path');
  }

  {
    const scene = makeSceneWithImages([
      makeImageObject('missing', 'photos', 'indexeddb://img_missing'),
    ]);
    const annotated = applyMissingImageReferenceState(scene, [{
      objectId: 'missing',
      objectName: 'missing',
      layerId: 'photos',
      layerName: 'Photos',
      src: 'indexeddb://img_missing',
      imageId: 'img_missing',
    }]);
    assert((annotated.objects[0].geometry as ImageGeometry).missingSource === true, 'applyMissingImageReferenceState can annotate from a stored report');
  }

  {
    const toolbarSource = readFileSync('src/ui/components/FileToolbar.tsx', 'utf-8');
    assert(toolbarSource.includes('validateAndAnnotateImageReferences'), 'FileToolbar validates image refs during Open');
    const fileHandlersSource = readFileSync('src/ui/hooks/useFileHandlers.ts', 'utf-8');
    assert(fileHandlersSource.includes('validateAndAnnotateImageReferences'), 'keyboard/file handlers validate image refs during Open');
    const importSource = readFileSync('src/ui/hooks/useImport.ts', 'utf-8');
    assert(importSource.includes('validateAndAnnotateImageReferences'), 'drag/drop project import validates image refs');
    const wizardSource = readFileSync('src/ui/hooks/useWizardHandlers.ts', 'utf-8');
    assert(wizardSource.includes('validateAndAnnotateImageReferences'), 'autosave recovery validates image refs');
    const rendererSource = readFileSync('src/ui/renderers/SceneRenderer.ts', 'utf-8');
    assert(rendererSource.includes('Missing image'), 'renderer has a missing-image placeholder state');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
