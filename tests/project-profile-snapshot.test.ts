/**
 * T2-71: project metadata embeds a device-profile snapshot at save
 * time. Pre-T2-71 the project stored only `deviceProfileId`; if the
 * user edited the profile after save, reloading silently compiled
 * against new values. T2-71 stores the snapshot + provides
 * `checkProfileSnapshot` to detect mismatch on load.
 *
 * Run: npx tsx tests/project-profile-snapshot.test.ts
 */
import {
  diffProfiles,
  checkProfileSnapshot,
} from '../src/core/devices/profileSnapshot';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { serializeScene, deserializeScene } from '../src/io/SceneSerializer';
import type { DeviceProfile } from '../src/core/devices/DeviceProfile';

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

function setupProfile(name: string, overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...createBlankProfile(name), ...overrides };
}

console.log('\n=== T2-71 device-profile snapshot ===\n');

void (async () => {

// 1. diffProfiles: identical profiles → no changes
{
  const a = setupProfile('A');
  const b = { ...a };
  const changes = diffProfiles(a, b);
  assert(changes.length === 0,
    `identical profiles: 0 changes (got ${changes.length})`);
}

// 2. diffProfiles: maxSpindle changed → reports the change
{
  const saved = setupProfile('Falcon', { maxSpindle: 1000 });
  const current = setupProfile('Falcon', { maxSpindle: 255 });
  const changes = diffProfiles(saved, current);
  const ms = changes.find(c => c.field === 'maxSpindle');
  assert(ms != null && ms.saved === 1000 && ms.current === 255,
    `maxSpindle drift detected (got ${changes.length} changes; ms=${JSON.stringify(ms)})`);
}

// 3. diffProfiles: bedWidth + originCorner together
{
  const saved = setupProfile('Falcon', { bedWidth: 400, originCorner: 'front-left' });
  const current = setupProfile('Falcon', { bedWidth: 600, originCorner: 'rear-left' });
  const changes = diffProfiles(saved, current);
  const fields = changes.map(c => c.field).sort();
  assert(fields.includes('bedWidth') && fields.includes('originCorner'),
    `multi-field drift detected (got fields=${fields.join(',')})`);
}

// 3b. diffProfiles: profile WCS compatibility is tracked because it changes
//     the final Start gate on machines that cannot report GRBL WCS state.
{
  const saved = setupProfile('Manual-zero', { allowUnverifiedWcsStart: false });
  const current = setupProfile('Manual-zero', { allowUnverifiedWcsStart: true });
  const changes = diffProfiles(saved, current);
  const wcs = changes.find(c => c.field === 'allowUnverifiedWcsStart');
  assert(
    wcs != null && wcs.saved === false && wcs.current === true,
    `allowUnverifiedWcsStart drift detected (got ${changes.length} changes; wcs=${JSON.stringify(wcs)})`,
  );
}

// 4. diffProfiles: cosmetic-only fields (name, id) NOT tracked
{
  const saved = setupProfile('Old name', { id: 'p1' });
  const current = setupProfile('New name', { id: 'p1' });
  // name/id are not in TRACKED_FIELDS — only safety-relevant fields
  const changes = diffProfiles(saved, current);
  assert(changes.length === 0,
    `cosmetic field changes (name) NOT tracked (got ${changes.length} changes)`);
}

// 5. checkProfileSnapshot: no snapshot in scene → 'no-snapshot'
{
  const scene = createScene(400, 300, 'no-snapshot-scene');
  scene.metadata.deviceProfileId = null;
  const result = checkProfileSnapshot(scene, () => null);
  assert(result.kind === 'no-snapshot',
    `no snapshot: kind='no-snapshot' (got ${result.kind})`);
}

// 6. checkProfileSnapshot: snapshot present but ID null → 'no-current-profile'
{
  const scene = createScene(400, 300, 's');
  const snap = setupProfile('saved', { id: 'p1' });
  scene.metadata.deviceProfileSnapshot = snap;
  scene.metadata.deviceProfileId = null;
  const result = checkProfileSnapshot(scene, () => null);
  assert(result.kind === 'no-current-profile',
    `null id: kind='no-current-profile' (got ${result.kind})`);
}

// 7. checkProfileSnapshot: snapshot present, ID set, profile deleted → 'profile-deleted'
{
  const scene = createScene(400, 300, 's');
  const snap = setupProfile('saved', { id: 'p1' });
  scene.metadata.deviceProfileSnapshot = snap;
  scene.metadata.deviceProfileId = 'p1';
  const result = checkProfileSnapshot(scene, () => null);
  assert(result.kind === 'profile-deleted',
    `deleted profile: kind='profile-deleted' (got ${result.kind})`);
  if (result.kind === 'profile-deleted') {
    assert(result.snapshot.id === 'p1',
      `profile-deleted: snapshot returned for fallback`);
  }
}

// 8. checkProfileSnapshot: identical → 'match'
{
  const scene = createScene(400, 300, 's');
  const profile = setupProfile('saved', { id: 'p1', maxSpindle: 1000 });
  scene.metadata.deviceProfileSnapshot = profile;
  scene.metadata.deviceProfileId = 'p1';
  const result = checkProfileSnapshot(scene, () => ({ ...profile }));
  assert(result.kind === 'match',
    `match: kind='match' (got ${result.kind})`);
}

// 9. checkProfileSnapshot: drift → 'mismatch' with changed fields
{
  const scene = createScene(400, 300, 's');
  const saved = setupProfile('Falcon', { id: 'p1', maxSpindle: 1000 });
  scene.metadata.deviceProfileSnapshot = saved;
  scene.metadata.deviceProfileId = 'p1';
  const current = { ...saved, maxSpindle: 255 };
  const result = checkProfileSnapshot(scene, () => current);
  assert(result.kind === 'mismatch',
    `drift: kind='mismatch' (got ${result.kind})`);
  if (result.kind === 'mismatch') {
    const fields = result.changed.map(c => c.field);
    assert(fields.includes('maxSpindle'),
      `mismatch: changed list names maxSpindle (got ${fields.join(',')})`);
  }
}

// 10. Round-trip: serialize + deserialize preserves snapshot
{
  const scene = createScene(400, 300, 'roundtrip');
  const profile = setupProfile('Falcon', { id: 'p1', maxSpindle: 1000, bedWidth: 400 });
  scene.metadata.deviceProfileSnapshot = profile;
  scene.metadata.deviceProfileId = 'p1';
  const json = serializeScene(scene);
  const reloaded = deserializeScene(json);
  assert(reloaded != null,
    'roundtrip: deserialize returns a scene');
  if (reloaded) {
    assert(reloaded.metadata.deviceProfileSnapshot != null,
      `roundtrip: snapshot preserved`);
    assert(reloaded.metadata.deviceProfileSnapshot?.id === 'p1' &&
      reloaded.metadata.deviceProfileSnapshot?.maxSpindle === 1000,
      `roundtrip: snapshot fields intact (got id=${reloaded.metadata.deviceProfileSnapshot?.id}, maxSpindle=${reloaded.metadata.deviceProfileSnapshot?.maxSpindle})`);
  }
}

// 11. Round-trip backward-compat: legacy project (no snapshot) deserializes
//     with no snapshot field, no errors
{
  const scene = createScene(400, 300, 'legacy');
  scene.metadata.deviceProfileId = 'p1';
  // Do NOT set snapshot
  const json = serializeScene(scene);
  const reloaded = deserializeScene(json);
  assert(reloaded != null,
    'legacy roundtrip: deserialize returns a scene');
  if (reloaded) {
    assert(reloaded.metadata.deviceProfileSnapshot == null,
      `legacy: snapshot stays absent`);
    assert(reloaded.metadata.deviceProfileId === 'p1',
      `legacy: deviceProfileId still preserved`);
  }
}

// 12. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/core/devices/profileSnapshot.ts'),
    'utf-8',
  );
  assert(/T2-71/.test(helperSrc), 'T2-71 marker in profileSnapshot.ts');
  for (const k of ['no-snapshot', 'no-current-profile', 'profile-deleted', 'match', 'mismatch']) {
    assert(helperSrc.includes(`'${k}'`),
      `ProfileSnapshotResult kind '${k}' declared`);
  }
  const sceneSrc = fs.readFileSync(
    path.resolve(here, '../src/core/scene/Scene.ts'),
    'utf-8',
  );
  assert(/T2-71/.test(sceneSrc), 'T2-71 marker in Scene.ts');
  assert(/deviceProfileSnapshot\?:/.test(sceneSrc),
    'metadata.deviceProfileSnapshot? declared');
  const serSrc = fs.readFileSync(
    path.resolve(here, '../src/io/SceneSerializer.ts'),
    'utf-8',
  );
  assert(/T2-71/.test(serSrc), 'T2-71 marker in SceneSerializer.ts');
  assert(/deviceProfileSnapshot/.test(serSrc),
    'serializer reads/writes deviceProfileSnapshot');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
