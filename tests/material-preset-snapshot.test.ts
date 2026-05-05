/**
 * T2-72: per-layer material preset snapshot. Pre-T2-72 a layer kept
 * only `materialPresetId`; preset library updates after save silently
 * changed compile output. T2-72 stores the snapshot at apply time so
 * load-time mismatch detection (`checkPresetSnapshot`) can offer the
 * user a choice.
 *
 * Run: npx tsx tests/material-preset-snapshot.test.ts
 */
import {
  type MaterialPresetSnapshot,
  buildPresetSnapshot,
  diffPreset,
  checkPresetSnapshot,
} from '../src/core/materials/MaterialPresetSnapshot';
import type { MaterialPreset } from '../src/core/materials/MaterialPreset';

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

function makePreset(overrides: Partial<MaterialPreset> = {}): MaterialPreset {
  return {
    id: 'basswood-3mm-cut',
    name: 'Basswood 3mm Cut',
    material: 'wood',
    thickness: '3mm',
    laserWattage: '20W',
    operations: {
      cut: { power: 85, speed: 220, passes: 1 },
    },
    kerf: 0.1,
    leadIn: 1.0,
    zOffset: -2,
    ...overrides,
  };
}

console.log('\n=== T2-72 material preset snapshot ===\n');

void (async () => {

// 1. buildPresetSnapshot copies compile-relevant fields with appliedAt timestamp
{
  const preset = makePreset();
  const snap = buildPresetSnapshot(preset);
  assert(snap.id === preset.id && snap.name === preset.name,
    `buildPresetSnapshot: id + name preserved`);
  assert(snap.kerf === 0.1 && snap.leadIn === 1.0 && snap.zOffset === -2,
    `buildPresetSnapshot: kerf/leadIn/zOffset captured`);
  assert(snap.operations.cut?.power === 85 && snap.operations.cut?.speed === 220,
    `buildPresetSnapshot: operations.cut captured`);
  assert(typeof snap.appliedAt === 'string' && snap.appliedAt.length > 0,
    `buildPresetSnapshot: appliedAt populated`);
}

// 2. diffPreset: identical → 0 changes
{
  const preset = makePreset();
  const snap = buildPresetSnapshot(preset);
  const changes = diffPreset(snap, preset);
  assert(changes.length === 0,
    `identical: 0 changes (got ${changes.length})`);
}

// 3. diffPreset: power change in operations.cut detected
{
  const saved = buildPresetSnapshot(makePreset());
  const current = makePreset({
    operations: { cut: { power: 90, speed: 220, passes: 1 } },
  });
  const changes = diffPreset(saved, current);
  const opChange = changes.find(c => c.field === 'operations');
  assert(opChange != null,
    `power change: operations diff reported (got fields=${changes.map(c => c.field).join(',')})`);
}

// 4. diffPreset: kerf change detected as its own field
{
  const saved = buildPresetSnapshot(makePreset({ kerf: 0.1 }));
  const current = makePreset({ kerf: 0.15 });
  const changes = diffPreset(saved, current);
  const kerfChange = changes.find(c => c.field === 'kerf');
  assert(kerfChange != null && kerfChange.saved === 0.1 && kerfChange.current === 0.15,
    `kerf change: detected with values (got ${JSON.stringify(kerfChange)})`);
}

// 5. diffPreset: name change detected
{
  const saved = buildPresetSnapshot(makePreset({ name: 'Old name' }));
  const current = makePreset({ name: 'New name' });
  const changes = diffPreset(saved, current);
  const nameChange = changes.find(c => c.field === 'name');
  assert(nameChange != null,
    `name change: detected`);
}

// 6. checkPresetSnapshot: no snapshot → 'no-snapshot'
{
  const result = checkPresetSnapshot('layer1', 'preset1', undefined, () => null);
  assert(result.kind === 'no-snapshot',
    `no snapshot: kind='no-snapshot' (got ${result.kind})`);
}

// 7. checkPresetSnapshot: snapshot but layer has no presetId → 'no-current-preset'
{
  const snap = buildPresetSnapshot(makePreset());
  const result = checkPresetSnapshot('layer1', undefined, snap, () => null);
  assert(result.kind === 'no-current-preset',
    `no preset id: kind='no-current-preset' (got ${result.kind})`);
}

// 8. checkPresetSnapshot: preset deleted from library → 'preset-deleted'
{
  const snap = buildPresetSnapshot(makePreset());
  const result = checkPresetSnapshot('layer1', 'preset1', snap, () => null);
  assert(result.kind === 'preset-deleted',
    `deleted preset: kind='preset-deleted' (got ${result.kind})`);
  if (result.kind === 'preset-deleted') {
    assert(result.snapshot === snap,
      `preset-deleted: snapshot returned for fallback`);
  }
}

// 9. checkPresetSnapshot: identical → 'match'
{
  const preset = makePreset();
  const snap = buildPresetSnapshot(preset);
  const result = checkPresetSnapshot('layer1', preset.id, snap, () => preset);
  assert(result.kind === 'match',
    `match: kind='match' (got ${result.kind})`);
}

// 10. checkPresetSnapshot: drift → 'mismatch' with changed list
{
  const preset = makePreset({ kerf: 0.1 });
  const snap = buildPresetSnapshot(preset);
  const current = makePreset({ kerf: 0.2 });
  const result = checkPresetSnapshot('layer1', preset.id, snap, () => current);
  assert(result.kind === 'mismatch',
    `drift: kind='mismatch' (got ${result.kind})`);
  if (result.kind === 'mismatch') {
    const fields = result.changed.map(c => c.field);
    assert(fields.includes('kerf'),
      `drift: changed list names kerf (got ${fields.join(',')})`);
  }
}

// 11. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/core/materials/MaterialPresetSnapshot.ts'),
    'utf-8',
  );
  assert(/T2-72/.test(helperSrc), 'T2-72 marker in MaterialPresetSnapshot.ts');
  for (const k of ['no-snapshot', 'no-current-preset', 'preset-deleted', 'match', 'mismatch']) {
    assert(helperSrc.includes(`'${k}'`),
      `PresetSnapshotResult kind '${k}' declared`);
  }
  const layerSrc = fs.readFileSync(
    path.resolve(here, '../src/core/scene/Layer.ts'),
    'utf-8',
  );
  assert(/T2-72/.test(layerSrc), 'T2-72 marker in Layer.ts');
  assert(/materialPresetSnapshot\?:/.test(layerSrc),
    'LaserSettings.materialPresetSnapshot? declared');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
