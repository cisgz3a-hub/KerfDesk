/**
 * Autosave preserves full image payload (no silent stripping).
 * Run: npx tsx tests/autosave-preserves-images.test.ts
 */
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { type SceneObject, type ImageGeometry } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';
import { serializeForAutosave, deserializeScene } from '../src/io/SceneSerializer';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function makeImageObject(layerId: string): SceneObject {
  const w = 40;
  const h = 30;
  const src =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const geom: ImageGeometry = {
    type: 'image',
    src,
    originalWidth: w,
    originalHeight: h,
    cropX: 0,
    cropY: 0,
    cropWidth: w,
    cropHeight: h,
    grayscaleData: new Uint8Array(w * h).fill(128),
    grayscaleWidth: w,
    grayscaleHeight: h,
    adjustedData: new Uint8Array(w * h).fill(64),
  };
  return {
    id: generateId(),
    type: 'image',
    name: 'Img',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 5, ty: 5 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function run(): void {
  console.log('\n=== autosave preserves images ===\n');

  const base = createScene(400, 300, 'Img Autosave');
  const lid = base.layers[0].id;
  const scene = addObject(base, makeImageObject(lid));

  const autoJson = serializeForAutosave(scene);
  assert(autoJson.includes('data:image/png;base64'), 'serializeForAutosave keeps image src');
  assert(
    autoJson.includes('_grayscaleDataB64') || autoJson.includes('grayscaleData'),
    'serializeForAutosave keeps grayscale payload (b64 or raw)',
  );

  const recovered = deserializeScene(autoJson);
  assert(recovered.objects.length === 1, 'one object after deserialize');
  const g = recovered.objects[0]!.geometry as ImageGeometry;
  assert(g.type === 'image', 'geometry type image');
  assert(g.src.includes('data:image/png'), 'src round-trip');
  assert(g.grayscaleData instanceof Uint8Array && g.grayscaleData.length > 0, 'grayscaleData restored');
  assert(g.adjustedData instanceof Uint8Array && g.adjustedData.length > 0, 'adjustedData restored');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

try {
  run();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
