/**
 * T2-74: deserializeSceneWithReport surfaces silent project-load
 * repairs. Pre-T2-74 the deserializer relocated orphan objects,
 * cleared broken parent references, removed duplicate-id objects,
 * and reset invalid activeLayerId without telling the user. A user
 * loading their own project could discover their groups got dropped
 * or objects got moved without any signal.
 *
 * Run: npx tsx tests/load-repair-report.test.ts
 */
import {
  deserializeScene,
  deserializeSceneWithReport,
  serializeScene,
  type ProjectLoadReport,
} from '../src/io/SceneSerializer';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type RectGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX } from '../src/core/types';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function makeRect(id: string, layerId: string, parentId: string | null = null): SceneObject {
  return {
    id, type: 'rect', name: id, layerId, parentId,
    transform: { ...IDENTITY_MATRIX },
    geometry: { type: 'rect', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } as RectGeometry,
    visible: true, locked: false, powerScale: 1,
    _bounds: null, _worldTransform: null,
  };
}

/**
 * The .laserforge.json envelope nests the scene under `scene`. Tamper
 * functions operate on the nested scene to make assertions about
 * parsed.objects, parsed.activeLayerId, etc.
 */
function tamper(json: string, mutator: (parsedScene: Record<string, unknown>) => void): string {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const scene = parsed.scene as Record<string, unknown>;
  mutator(scene);
  return JSON.stringify(parsed);
}

console.log('\n=== T2-74 load repair report ===\n');

void (async () => {

// 1. Clean project: empty repairs array
{
  const scene = createScene(400, 300, 'clean');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.activeLayerId = 'L1';
  scene.objects = [makeRect('o1', 'L1')];
  const report = deserializeSceneWithReport(serializeScene(scene));
  assert(report.repairs.length === 0,
    `clean project: 0 repairs (got ${report.repairs.length})`);
  assert(report.scene != null && report.scene.objects.length === 1,
    `clean project: scene loaded with object intact`);
}

// 2. Orphan objects relocated
{
  const scene = createScene(400, 300, 'orphan');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.activeLayerId = 'L1';
  scene.objects = [makeRect('o1', 'L1'), makeRect('o2', 'L1')];
  const json = tamper(serializeScene(scene), parsed => {
    const objs = parsed.objects as Array<Record<string, unknown>>;
    objs[1].layerId = 'gone-layer';
  });
  const report = deserializeSceneWithReport(json);
  const orphan = report.repairs.find(r => r.kind === 'orphan-objects-relocated');
  assert(orphan != null && orphan.count === 1,
    `orphan: 1 relocation (got ${JSON.stringify(orphan)})`);
  assert(/no longer exist/.test(orphan?.details ?? ''),
    `orphan: details message names the cause`);
  // Verify the object actually got moved to the surviving layer
  assert(report.scene.objects[1].layerId === 'L1',
    `orphan: object now on default layer`);
}

// 3. Duplicate objects removed
{
  const scene = createScene(400, 300, 'dupes');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.activeLayerId = 'L1';
  scene.objects = [makeRect('a', 'L1')];
  const json = tamper(serializeScene(scene), parsed => {
    const objs = parsed.objects as Array<Record<string, unknown>>;
    objs.push({ ...objs[0] }); // duplicate the id
    objs.push({ ...objs[0] });
  });
  const report = deserializeSceneWithReport(json);
  const dupes = report.repairs.find(r => r.kind === 'duplicate-objects-removed');
  assert(dupes != null && dupes.count === 2,
    `duplicate: 2 removed (got ${JSON.stringify(dupes)})`);
  assert(report.scene.objects.length === 1,
    `duplicate: only 1 object after dedupe`);
}

// 4. Broken parent cleared
{
  const scene = createScene(400, 300, 'broken-parent');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.activeLayerId = 'L1';
  scene.objects = [makeRect('child', 'L1', 'gone-parent')];
  const report = deserializeSceneWithReport(serializeScene(scene));
  const broken = report.repairs.find(r => r.kind === 'broken-parent-cleared');
  assert(broken != null && broken.count === 1,
    `broken-parent: 1 cleared (got ${JSON.stringify(broken)})`);
  assert(report.scene.objects[0].parentId === null,
    `broken-parent: parentId now null`);
}

// 5. Invalid active layer reset
{
  const scene = createScene(400, 300, 'invalid-active');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.activeLayerId = 'L1';
  scene.objects = [makeRect('o1', 'L1')];
  const json = tamper(serializeScene(scene), parsed => {
    parsed.activeLayerId = 'gone-layer';
  });
  const report = deserializeSceneWithReport(json);
  const ial = report.repairs.find(r => r.kind === 'invalid-active-layer');
  assert(ial != null && ial.count === 1,
    `invalid-active-layer: 1 reset (got ${JSON.stringify(ial)})`);
  assert(report.scene.activeLayerId === 'L1',
    `invalid-active-layer: scene.activeLayerId reset to surviving layer`);
}

// 6. Multiple repair kinds in one project: all reported
{
  const scene = createScene(400, 300, 'multi');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.activeLayerId = 'L1';
  scene.objects = [
    makeRect('a', 'L1'),
    makeRect('b', 'L1', 'gone-parent'),
  ];
  const json = tamper(serializeScene(scene), parsed => {
    const objs = parsed.objects as Array<Record<string, unknown>>;
    objs[0].layerId = 'gone-layer';                // orphan
    objs.push({ ...objs[0] });                      // duplicate
    parsed.activeLayerId = 'gone';                  // invalid active
  });
  const report = deserializeSceneWithReport(json);
  const kinds = new Set(report.repairs.map(r => r.kind));
  assert(kinds.has('orphan-objects-relocated'),
    `multi: orphan repair reported`);
  assert(kinds.has('duplicate-objects-removed'),
    `multi: duplicate repair reported`);
  assert(kinds.has('broken-parent-cleared'),
    `multi: broken-parent repair reported`);
  assert(kinds.has('invalid-active-layer'),
    `multi: invalid-active-layer repair reported`);
}

// 7. Backward-compat: deserializeScene still returns Scene directly
//    (no breaking change for existing callers)
{
  const scene = createScene(400, 300, 'compat');
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'L1';
  scene.layers = [layer];
  scene.objects = [makeRect('o1', 'L1')];
  const reloaded = deserializeScene(serializeScene(scene));
  assert(reloaded != null && reloaded.objects.length === 1,
    `compat: deserializeScene still returns Scene directly`);
}

// 8. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/io/SceneSerializer.ts'),
    'utf-8',
  );
  assert(/T2-74/.test(src), 'T2-74 marker in SceneSerializer.ts');
  for (const k of ['orphan-objects-relocated', 'duplicate-objects-removed',
    'broken-parent-cleared', 'invalid-active-layer']) {
    assert(src.includes(`'${k}'`),
      `ProjectRepairKind '${k}' declared`);
  }
  assert(/export function deserializeSceneWithReport/.test(src),
    'deserializeSceneWithReport exported');
  assert(/repairs\?: ProjectRepair\[\]/.test(src),
    'buildSceneFromParsedEnvelope accepts optional repairs collector');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
