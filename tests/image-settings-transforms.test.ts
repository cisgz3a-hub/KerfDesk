/**
 * T1-130: regression test for the pure image-settings preview +
 * commit transforms extracted from PropertiesPanel. First
 * PropertiesPanel decomposition slice.
 *
 * Pre-T1-130 the transforms lived inline as the bodies of two
 * useCallback wrappers. Pure extraction lets us pin the contract:
 *   - preview is a single-field update on both image-geometry AND
 *     parent layer (consistency for the JobCompiler-side compile)
 *   - commit applies the brightness/contrast/gamma/invert quad and
 *     clears adjustedData/ditherMode so the compile-pipeline cache
 *     re-derives (T1-17 Pass 4c)
 *   - both invalidate per-object _bounds + _worldTransform caches
 *   - both no-op when target is missing or non-image
 *   - commit no-ops when target image has no grayscaleData (not
 *     decoded yet — nothing meaningful to commit)
 *
 * Run: npx tsx tests/image-settings-transforms.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/core/scene/Scene';
import type { ImageGeometry, SceneObject } from '../src/core/scene/SceneObject';
import {
  applyImageSettingsCommit,
  applyImageSettingsPreview,
} from '../src/ui/components/properties/imageSettingsTransforms';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function makeImage(overrides: Partial<ImageGeometry> = {}): ImageGeometry {
  return {
    type: 'image',
    src: 'data:image/png;base64,...',
    originalWidth: 100,
    originalHeight: 100,
    grayscaleWidth: 100,
    grayscaleHeight: 100,
    grayscaleData: new Uint8Array(100 * 100),
    brightness: 0,
    contrast: 0,
    gamma: 1,
    invert: false,
    ...overrides,
  } as ImageGeometry;
}

function makeScene(geom: ImageGeometry = makeImage()): Scene {
  const obj = {
    id: 'img-1',
    layerId: 'l1',
    name: 'img',
    visible: true,
    locked: false,
    selected: false,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    geometry: geom,
    _bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    _worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  } as unknown as SceneObject;
  return {
    id: 's',
    version: 1,
    canvas: { width: 200, height: 200 } as never,
    objects: [obj],
    layers: [
      {
        id: 'l1',
        name: 'L1',
        color: '#ff0000',
        visible: true,
        locked: false,
        output: true,
        settings: { image: {} } as never,
      } as never,
    ],
    activeLayerId: 'l1',
    metadata: { name: 't' } as never,
  } as unknown as Scene;
}

console.log('\n=== T1-130 image-settings transforms ===\n');

// -------- 1. preview: missing target → unchanged --------
{
  const s = makeScene();
  const r = applyImageSettingsPreview(s, 'nope', 'brightness', 50);
  assert(r === s, 'preview: missing objId → same scene reference (no-op)');
}

// -------- 2. preview: target found → both object + layer updated --------
{
  const s = makeScene();
  const r = applyImageSettingsPreview(s, 'img-1', 'brightness', 50);
  const obj = r.objects[0] as SceneObject & { geometry: ImageGeometry };
  assert(obj.geometry.brightness === 50, 'preview: object brightness updated');
  const layer = r.layers[0] as { settings: { image: { brightness?: number } } };
  assert(layer.settings.image.brightness === 50,
    'preview: parent layer brightness updated (mirror)');
}

// -------- 3. preview: caches invalidated --------
{
  const s = makeScene();
  const r = applyImageSettingsPreview(s, 'img-1', 'contrast', 25);
  const obj = r.objects[0] as SceneObject;
  assert(obj._bounds === null, 'preview: _bounds invalidated');
  assert(obj._worldTransform === null, 'preview: _worldTransform invalidated');
}

// -------- 4. preview: only target object/layer touched --------
{
  const base = makeScene();
  // Add a second image on a different layer.
  const second = {
    ...(base.objects[0] as SceneObject),
    id: 'img-2',
    layerId: 'l2',
  } as unknown as SceneObject;
  const s: Scene = {
    ...base,
    objects: [...base.objects, second],
    layers: [
      ...base.layers,
      {
        id: 'l2',
        name: 'L2',
        color: '#00ff00',
        visible: true,
        locked: false,
        output: true,
        settings: { image: {} } as never,
      } as never,
    ],
  };
  const r = applyImageSettingsPreview(s, 'img-1', 'gamma', 2);
  const img1 = r.objects.find((o) => o.id === 'img-1') as SceneObject;
  const img2 = r.objects.find((o) => o.id === 'img-2') as SceneObject;
  assert((img1.geometry as ImageGeometry).gamma === 2,
    'preview: img-1 updated');
  assert((img2.geometry as ImageGeometry).gamma === 1,
    'preview: img-2 NOT updated (different objId)');
}

// -------- 5. commit: missing target → null --------
{
  const r = applyImageSettingsCommit(makeScene(), 'nope');
  assert(r === null, 'commit: missing target → null');
}

// -------- 6. commit: no grayscaleData → null (T1-130 guard preserves
//             pre-fix behavior) --------
{
  const geom = makeImage({ grayscaleData: undefined });
  const r = applyImageSettingsCommit(makeScene(geom), 'img-1');
  assert(r === null, 'commit: image without grayscaleData → null');
}

// -------- 7. commit: overrides win over current settings --------
{
  const r = applyImageSettingsCommit(makeScene(makeImage({ brightness: 10 })), 'img-1', {
    brightness: 75,
  });
  assert(r != null, 'commit: returns non-null result');
  assert(r?.brightness === 75, 'commit: override brightness wins (got 75 vs current 10)');
  const obj = r!.scene.objects[0] as SceneObject;
  assert((obj.geometry as ImageGeometry).brightness === 75,
    'commit: object geometry brightness reflects override');
}

// -------- 8. commit: missing overrides fall back to current geometry --------
{
  const geom = makeImage({ brightness: 5, contrast: 10, gamma: 1.5, invert: true });
  const r = applyImageSettingsCommit(makeScene(geom), 'img-1');
  assert(r != null, 'commit: returns non-null for default-fallback path');
  assert(r?.brightness === 5 && r.contrast === 10 && r.gamma === 1.5 && r.invert === true,
    'commit: missing overrides fall back to current geometry values');
}

// -------- 9. commit: defaults when geometry fields absent --------
{
  // Geometry without brightness/contrast/gamma/invert set.
  const geom = makeImage({
    brightness: undefined,
    contrast: undefined,
    gamma: undefined,
    invert: undefined,
  });
  const r = applyImageSettingsCommit(makeScene(geom), 'img-1');
  assert(r != null, 'commit: returns non-null with missing geometry fields');
  assert(r?.brightness === 0 && r.contrast === 0 && r.gamma === 1 && r.invert === false,
    'commit: defaults to brightness=0 contrast=0 gamma=1 invert=false');
}

// -------- 10. commit: adjustedData + ditherMode cleared so cache re-derives --------
{
  const geom = makeImage({
    adjustedData: new Uint8Array(10),
    ditherMode: 'floyd-steinberg' as never,
  });
  const r = applyImageSettingsCommit(makeScene(geom), 'img-1', { brightness: 20 });
  assert(r != null, 'commit: returns non-null');
  const newGeom = (r!.scene.objects[0] as SceneObject).geometry as ImageGeometry;
  assert(newGeom.adjustedData === undefined,
    'commit: adjustedData cleared (compile cache re-derives — T1-17 Pass 4c)');
  assert(newGeom.ditherMode === undefined,
    'commit: ditherMode cleared');
}

// -------- 11. commit: layer settings.image mirrors the quad --------
{
  const r = applyImageSettingsCommit(makeScene(), 'img-1', {
    brightness: 30,
    contrast: 40,
    gamma: 2,
    invert: true,
  });
  const layer = r!.scene.layers[0] as unknown as { settings: { image: ImageGeometry } };
  assert(
    layer.settings.image.brightness === 30
      && layer.settings.image.contrast === 40
      && layer.settings.image.gamma === 2
      && layer.settings.image.invert === true,
    'commit: layer.settings.image mirrors the quad',
  );
}

// -------- 12. Source-level pin: PropertiesPanel delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/PropertiesPanel.tsx'),
    'utf-8',
  );
  assert(/applyImageSettingsPreview/.test(panelSrc),
    'PropertiesPanel imports / calls applyImageSettingsPreview');
  assert(/applyImageSettingsCommit/.test(panelSrc),
    'PropertiesPanel imports / calls applyImageSettingsCommit');
  assert(/T1-130/.test(panelSrc),
    'PropertiesPanel carries T1-130 marker');
  // The pre-T1-130 inline 100-line transform body is gone. Pin one
  // distinctive sub-expression to make sure it didn't get duplicated.
  assert(
    !/s\.objects\.find\(o => o\.id === objId && o\.geometry\.type === 'image'\);[\s\S]{0,200}geometry: \{ \.\.\.geom/.test(panelSrc),
    'inline preview transform body is gone from PropertiesPanel',
  );

  const transformsSrc = readFileSync(
    resolve(here, '../src/ui/components/properties/imageSettingsTransforms.ts'),
    'utf-8',
  );
  assert(/T1-130/.test(transformsSrc),
    'imageSettingsTransforms carries T1-130 marker');
  assert(/export function applyImageSettingsPreview/.test(transformsSrc),
    'applyImageSettingsPreview is exported');
  assert(/export function applyImageSettingsCommit/.test(transformsSrc),
    'applyImageSettingsCommit is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
