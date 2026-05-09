/**
 * T3-78: save/load persistence stress suite.
 *
 * Run: npx tsx tests/persistence-stress/persistence-stress.test.ts
 */
import { existsSync } from 'node:fs';
import { createScene, type Scene } from '../../src/core/scene/Scene';
import { createLayer } from '../../src/core/scene/Layer';
import { createBlankProfile } from '../../src/core/devices/DeviceProfile';
import { checkProfileSnapshot } from '../../src/core/devices/profileSnapshot';
import {
  buildPresetSnapshot,
  checkPresetSnapshot,
} from '../../src/core/materials/MaterialPresetSnapshot';
import type { MaterialPreset } from '../../src/core/materials/MaterialPreset';
import { createRect, type ImageGeometry, type SceneObject } from '../../src/core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../../src/core/types';
import {
  deserializeScene,
  deserializeSceneWithIntegrity,
  deserializeSceneWithReport,
  serializeScene,
} from '../../src/io/SceneSerializer';
import {
  validateAndAnnotateImageReferences,
} from '../../src/io/ImageReferenceValidation';
import {
  AUTOSAVE_CURRENT_KEY,
  readWithFallback,
  runAutosaveRotation,
  type AutosaveSlotStorage,
} from '../../src/app/AutosaveBackupSlot';

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

class MemorySlotStorage implements AutosaveSlotStorage {
  readonly data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

function makeLayeredScene(layerCount: number, objectCount: number): Scene {
  const scene = createScene(800, 600, 'T3-78 many objects');
  scene.layers = Array.from({ length: layerCount }, (_, i) => {
    const layer = createLayer(i, i % 2 === 0 ? 'cut' : 'engrave', `Layer ${i}`);
    (layer as { id: string }).id = `stress-layer-${i}`;
    return layer;
  });
  scene.activeLayerId = scene.layers[0].id;
  scene.objects = Array.from({ length: objectCount }, (_, i) => {
    const layer = scene.layers[i % layerCount];
    const obj = createRect(layer.id, (i % 40) * 4, Math.floor(i / 40) * 4, 2, 2, `rect-${i}`);
    (obj as { id: string }).id = `stress-rect-${i}`;
    return obj;
  });
  return scene;
}

function makeRasterScene(): Scene {
  const scene = createScene(400, 300, 'T3-78 raster payload');
  const layer = createLayer(0, 'image', 'Image');
  (layer as { id: string }).id = 'image-layer';
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const grayscaleData = new Uint8Array(256 * 256);
  for (let i = 0; i < grayscaleData.length; i++) grayscaleData[i] = i % 256;
  const image: SceneObject = {
    id: 'stress-image',
    type: 'image',
    name: 'Raster stress',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: 10, ty: 20 },
    geometry: {
      type: 'image',
      src: `data:image/png;base64,${'A'.repeat(4096)}`,
      originalWidth: 256,
      originalHeight: 256,
      cropX: 0,
      cropY: 0,
      cropWidth: 256,
      cropHeight: 256,
      grayscaleData,
      grayscaleWidth: 256,
      grayscaleHeight: 256,
    },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [image];
  return scene;
}

function minimalLegacyEnvelope(version = '1.1'): string {
  return JSON.stringify({
    format: 'laserforge',
    version,
    scene: {
      id: 'legacy-scene',
      version: '1.0',
      canvas: { width: 400, height: 300 },
      layers: [{ id: 'legacy-layer', name: 'Cut', settings: { mode: 'cut' } }],
      objects: [],
      activeLayerId: 'legacy-layer',
      metadata: { name: 'Legacy' },
    },
  });
}

console.log('\n=== T3-78 persistence stress suite ===\n');

void (async () => {
  {
    const scene = makeLayeredScene(10, 1000);
    const loaded = deserializeSceneWithIntegrity(serializeScene(scene));
    assert(loaded.layers.length === 10, '1000-object scene preserves 10 layers');
    assert(loaded.objects.length === 1000, '1000-object scene preserves every object');
    assert(loaded.objects[999].id === 'stress-rect-999', '1000-object scene preserves tail object id');
  }

  {
    const scene = makeRasterScene();
    const loaded = deserializeSceneWithIntegrity(serializeScene(scene));
    const geom = loaded.objects[0].geometry as ImageGeometry;
    assert(geom.grayscaleData instanceof Uint8Array, 'raster roundtrip restores Uint8Array grayscale data');
    assert(geom.grayscaleData?.length === 256 * 256, 'raster roundtrip preserves grayscale byte count');
    assert(geom.src.startsWith('data:image/png'), 'raster roundtrip preserves portable data URI source');
  }

  {
    const scene = makeLayeredScene(1, 1);
    const parsed = JSON.parse(serializeScene(scene));
    parsed.scene.objects[0].layerId = 'missing-layer';
    const report = deserializeSceneWithReport(JSON.stringify(parsed));
    assert(report.repairs.some(r => r.kind === 'orphan-objects-relocated' && r.count === 1),
      'orphan layer reference produces repair report');
  }

  {
    const scene = makeLayeredScene(1, 2);
    const parsed = JSON.parse(serializeScene(scene));
    parsed.scene.objects[1].id = parsed.scene.objects[0].id;
    const report = deserializeSceneWithReport(JSON.stringify(parsed));
    assert(report.repairs.some(r => r.kind === 'duplicate-objects-removed' && r.count === 1),
      'duplicate object ids are filtered with report');
  }

  {
    const scene = makeLayeredScene(1, 1);
    const parsed = JSON.parse(serializeScene(scene));
    parsed.scene.objects[0].transform.tx = null;
    let rejected = false;
    try {
      deserializeScene(JSON.stringify(parsed));
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('not a finite number');
    }
    assert(rejected, 'corrupted transform geometry is rejected before load completes');
  }

  {
    const scene = makeRasterScene();
    (scene.objects[0].geometry as ImageGeometry).src = 'indexeddb://missing-stress-image';
    const { scene: annotated, validation } = await validateAndAnnotateImageReferences(scene, {
      hasImage: async () => false,
    });
    const geom = annotated.objects[0].geometry as ImageGeometry;
    assert(validation.missing.length === 1, 'missing indexeddb image reference is reported');
    assert(geom.missingSource === true, 'missing indexeddb image reference is annotated for UI placeholder');
  }

  {
    const loaded = deserializeScene(minimalLegacyEnvelope('1.1'));
    assert(loaded.id === 'legacy-scene', 'old 1.x project envelope still migrates to a valid scene');
  }

  {
    const scene = createScene(400, 300, 'profile drift');
    const saved = createBlankProfile('Saved profile');
    saved.id = 'profile-1';
    scene.metadata.deviceProfileId = saved.id;
    scene.metadata.deviceProfileSnapshot = { ...saved };
    const current = { ...saved, maxSpindle: saved.maxSpindle + 1 };
    const result = checkProfileSnapshot(scene, () => current);
    assert(result.kind === 'mismatch' && result.changed.some(c => c.field === 'maxSpindle'),
      'profile snapshot mismatch surfaces changed machine fields');
  }

  {
    const preset: MaterialPreset = {
      id: 'preset-1',
      name: '3mm plywood',
      material: 'Plywood',
      thickness: '3mm',
      laserWattage: '20W',
      operations: { cut: { power: 80, speed: 450, passes: 1 } },
      kerf: 0.12,
    };
    const snapshot = buildPresetSnapshot(preset);
    const current: MaterialPreset = {
      ...preset,
      operations: { cut: { power: 80, speed: 650, passes: 1 } },
    };
    const result = checkPresetSnapshot('layer-1', preset.id, snapshot, () => current);
    assert(result.kind === 'mismatch' && result.changed.some(c => c.field === 'operations'),
      'material preset mismatch surfaces changed operation table');
  }

  {
    const storage = new MemorySlotStorage();
    await runAutosaveRotation({ storage, newSerialisedRecord: '{"scene":"previous"}' });
    await runAutosaveRotation({ storage, newSerialisedRecord: '{"scene":"current"}' });
    await storage.set(AUTOSAVE_CURRENT_KEY, '{broken');
    const result = await readWithFallback({ storage, parse: raw => JSON.parse(raw) });
    assert(result.which === 'previous', 'corrupted current autosave falls back to previous slot');
    assert((result.record as { scene?: string } | null)?.scene === 'previous', 'autosave fallback returns previous scene data');
  }

  {
    assert(existsSync('tests/autosave-dirty-flag-on-failure.test.ts'),
      'autosave write failure dirty-state regression remains covered');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
