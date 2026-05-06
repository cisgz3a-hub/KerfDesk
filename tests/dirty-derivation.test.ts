/**
 * T2-88: hash-derived dirty state. Pre-T2-88 the dirty flag was
 * manually toggled at every mutation site (`sceneIsDirtyRef.current
 * = true`). T1-73, T1-74, T1-75 each fixed a forgotten-toggle bug
 * in a different mutation path. T2-88 derives dirty from a hash
 * comparison so the entire defect class is closed by construction.
 *
 * This commit ships the hash + isDirty helper. Migration of the 17
 * sceneIsDirtyRef caller sites is filed as T2-88-followup.
 *
 * Run: npx tsx tests/dirty-derivation.test.ts
 */
import {
  hashSceneForPersistence,
  isDirty,
  hasMeaningfulContent,
} from '../src/app/sceneDirtyHash';
import { createScene } from '../src/core/scene/Scene';
import { createLayer } from '../src/core/scene/Layer';
import { type RectGeometry, type SceneObject } from '../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../src/core/types';

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

/**
 * Build a stable test scene. We override the auto-generated IDs on
 * the layer + object with fixed strings so two calls to this helper
 * produce hash-equivalent scenes — the audit's invariant ("same
 * content → same hash regardless of object identity") only holds
 * when the persistent identifiers are the same. In production, IDs
 * persist across mutations of the same logical entity, so this
 * fixed-id setup mirrors real usage.
 */
function makeRectScene(rectX: number = 10): ReturnType<typeof createScene> {
  const scene = createScene(400, 300, 'T2-88');
  // Override auto-generated scene id so two builds compare equal.
  (scene as { id: string }).id = 'fixed-scene';
  scene.metadata.created = '2026-01-01T00:00:00.000Z';
  scene.metadata.modified = '2026-01-01T00:00:00.000Z';
  const layer = createLayer(0, 'cut', 'Cut');
  (layer as { id: string }).id = 'fixed-layer';
  scene.layers = [layer];
  scene.activeLayerId = layer.id;
  const geom: RectGeometry = { type: 'rect', x: 0, y: 0, width: 50, height: 50, cornerRadius: 0 };
  const obj: SceneObject = {
    id: 'fixed-obj',
    type: 'rect',
    name: 'r',
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: rectX, ty: 10 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [obj];
  return scene;
}

console.log('\n=== T2-88 dirty derivation ===\n');

void (async () => {

// 1. Hash determinism: same scene reference → same hash, multiple calls
{
  const scene = makeRectScene();
  const h1 = hashSceneForPersistence(scene);
  const h2 = hashSceneForPersistence(scene);
  assert(h1 === h2 && h1.length > 0,
    `same scene reference: identical hash on repeated calls (got ${h1})`);
}

// 2. Hash stability: same content (different scene OBJECT) → same hash.
{
  const a = makeRectScene(10);
  const b = makeRectScene(10);
  const ha = hashSceneForPersistence(a);
  const hb = hashSceneForPersistence(b);
  assert(ha === hb,
    `equivalent scenes: identical hash regardless of object identity (got ${ha} vs ${hb})`);
}

// 3. Different content → different hash
{
  const a = makeRectScene(10);
  const b = makeRectScene(20); // rectangle moved
  assert(hashSceneForPersistence(a) !== hashSceneForPersistence(b),
    `mutated scene (rect.tx 10→20): hash differs`);
}

// 4. Selection state NOT in hash. (Scene has no selection field directly,
//    but ephemeral cached fields like _bounds shouldn't affect hash.)
{
  const a = makeRectScene(10);
  const b = makeRectScene(10);
  // Set a stale-cache field on `b`'s object — this is the kind of
  // ephemeral state the canonical form must strip.
  b.objects[0]._bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  b.objects[0]._worldTransform = { ...b.objects[0].transform };
  assert(hashSceneForPersistence(a) === hashSceneForPersistence(b),
    `_bounds + _worldTransform are excluded from canonical hash`);
}

// 5. modified timestamp NOT in hash. Saving updates it; the hash must
//    not include it or save would never clear dirty.
{
  const a = makeRectScene(10);
  const b = makeRectScene(10);
  a.metadata.modified = '2025-01-01T00:00:00.000Z';
  b.metadata.modified = '2026-12-31T23:59:59.000Z';
  assert(hashSceneForPersistence(a) === hashSceneForPersistence(b),
    `metadata.modified excluded from canonical hash`);
}

// 6. Scene name change DOES affect hash (it's persisted user content).
{
  const a = makeRectScene();
  const b = makeRectScene();
  b.metadata.name = 'Different name';
  assert(hashSceneForPersistence(a) !== hashSceneForPersistence(b),
    `metadata.name changes hash`);
}

// 7. isDirty(null lastSaved): false for empty scene, true for scene with content
{
  const empty = createScene(400, 300, 'empty');
  assert(isDirty(empty, null) === false,
    `null lastSaved + empty scene: not dirty (T1-71 "no meaningful content" rule)`);

  const withContent = makeRectScene();
  assert(isDirty(withContent, null) === true,
    `null lastSaved + scene with object: dirty`);
}

// 8. isDirty(matchingHash): not dirty
{
  const scene = makeRectScene();
  const h = hashSceneForPersistence(scene);
  assert(isDirty(scene, h) === false,
    `scene matches lastSavedHash: not dirty`);
}

// 9. isDirty after mutation: dirty
{
  const scene = makeRectScene(10);
  const h = hashSceneForPersistence(scene);
  // Mutate via a fresh scene representation (callers pass in updated scene objects)
  const mutated = makeRectScene(20);
  assert(isDirty(mutated, h) === true,
    `scene mutated since save: dirty`);
}

// 10. Round-trip: mutate then return to original content → not dirty
//     (the audit's headline win: hash-derived dirty handles "user
//     made change A then change inverse-A" correctly)
{
  const baseline = makeRectScene(10);
  const baselineHash = hashSceneForPersistence(baseline);
  // User mutates to rectX=20 (now dirty)
  const dirty1 = makeRectScene(20);
  assert(isDirty(dirty1, baselineHash) === true,
    `step 1: scene dirtied from baseline`);
  // User makes inverse change — back to rectX=10
  const restored = makeRectScene(10);
  assert(isDirty(restored, baselineHash) === false,
    `step 2: round-trip back to baseline → not dirty (the headline win over manual flagging)`);
}

// 11. hasMeaningfulContent: empty vs populated
{
  const empty = createScene(400, 300, 'empty');
  assert(hasMeaningfulContent(empty) === false,
    `hasMeaningfulContent(empty scene) === false`);
  const populated = makeRectScene();
  assert(hasMeaningfulContent(populated) === true,
    `hasMeaningfulContent(scene with rect) === true`);
}

// 12. Hash is hex format (8 chars from FNV-1a 32-bit)
{
  const scene = makeRectScene();
  const h = hashSceneForPersistence(scene);
  assert(/^[0-9a-f]{8}$/.test(h),
    `hash format: 8 hex chars (got "${h}")`);
}

// 13. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/app/sceneDirtyHash.ts'),
    'utf-8',
  );
  assert(/T2-88/.test(src), 'T2-88 marker in sceneDirtyHash.ts');
  assert(/hashSceneForPersistence/.test(src), 'hashSceneForPersistence exported');
  assert(/isDirty/.test(src), 'isDirty exported');
  assert(/hasMeaningfulContent/.test(src), 'hasMeaningfulContent exported');
  assert(/sortKeys/.test(src), 'canonicalization sorts keys for stability');
  assert(/grayscaleFingerprint/.test(src),
    'image buffer canonicalization uses fingerprint, not full content');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
