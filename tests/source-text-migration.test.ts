/**
 * Guardrails: path sourceText round-trip, legacy _sourceText migration, new saves use sourceText only.
 * Run: npx tsx tests/source-text-migration.test.ts
 */

import { serializeScene, deserializeScene } from '../src/io/SceneSerializer';
import { createScene } from '../src/core/scene/Scene';
import { addObject } from '../src/ui/history/SceneCommands';
import { type SceneObject, type PathGeometry } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function pathWithSource(layerId: string): SceneObject {
  const sourceText = {
    type: 'text' as const,
    text: 'Laser',
    fontSize: 8,
    fontFamily: 'Sans',
    letterSpacing: 3,
    lineSpacing: 110,
  };
  const geometry: PathGeometry = {
    type: 'path',
    subPaths: [{ segments: [{ type: 'line', to: { x: 1, y: 2 } }], closed: false }],
    sourceText,
  };
  return {
    id: generateId(),
    type: 'path',
    name: 'TextPath',
    layerId,
    parentId: null,
    transform: IDENTITY_MATRIX,
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

console.log('\n=== Source text migration guardrails ===');

const scene = createScene(200, 200, 'Src');
const lid = scene.layers[0].id;
const withPath = addObject(scene, pathWithSource(lid));

const parsedNew = JSON.parse(serializeScene(withPath)) as {
  scene: { objects: Array<{ geometry: Record<string, unknown> }> };
};
const geom = parsedNew.scene.objects[0].geometry;
const st = geom.sourceText;
assert(st != null && typeof st === 'object', 'fixture: serialized path has sourceText');
geom._sourceText = st;
delete geom.sourceText;
const legacyJson = JSON.stringify(parsedNew);
assert(legacyJson.includes('_sourceText'), 'fixture: legacy JSON contains _sourceText');

const migrated = deserializeScene(legacyJson);
const pg = migrated.objects[0].geometry as PathGeometry;
assert(pg.sourceText != null, 'legacy load: sourceText populated');
assert(pg.sourceText!.text === 'Laser', 'legacy load: text preserved');
assert(pg.sourceText!.letterSpacing === 3, 'legacy load: letterSpacing preserved');

const fresh = serializeScene(withPath);
assert(!fresh.includes('_sourceText'), 'new save: no _sourceText key');
assert(fresh.includes('"sourceText"'), 'new save: contains sourceText');

const round = deserializeScene(fresh);
const pg2 = round.objects[0].geometry as PathGeometry;
assert(pg2.sourceText?.lineSpacing === 110, 'round-trip: lineSpacing preserved');

const parsedBoth = JSON.parse(serializeScene(withPath)) as typeof parsedNew;
const g2 = parsedBoth.scene.objects[0].geometry;
g2._sourceText = { type: 'text', text: 'Stale', fontSize: 1, fontFamily: 'f' };
const dual = JSON.stringify(parsedBoth);
const loadedDual = deserializeScene(dual);
const pg3 = loadedDual.objects[0].geometry as PathGeometry & { _sourceText?: unknown };
assert(pg3.sourceText?.text === 'Laser', 'when sourceText present, _sourceText ignored for content');

const noSource = addObject(
  scene,
  {
    ...pathWithSource(lid),
    id: generateId(),
    name: 'Plain',
    geometry: { type: 'path', subPaths: [] },
  },
);
const back = deserializeScene(serializeScene(noSource));
assert(
  (back.objects.find(o => o.name === 'Plain')!.geometry as PathGeometry).sourceText === undefined,
  'path without sourceText stays bare',
);

const idStable = withPath.objects.find(o => o.name === 'TextPath')!.id;
assert(deserializeScene(fresh).objects.find(o => o.id === idStable) != null, 'round-trip preserves object id');

console.log(`\nSource text migration: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
