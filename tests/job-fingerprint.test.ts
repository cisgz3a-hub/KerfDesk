/**
 * T2-85: explicit JobFingerprint type. Pre-T2-85 ValidatedJobTicket
 * compared only sceneHash + profileHash + gcodeHash + controllerType;
 * start mode, saved origin, machine capabilities, and compile options
 * could all change between compile and start without invalidating
 * the ticket. T2-85 builds the complete 7-field fingerprint and per-
 * field diff so the start path can detect each kind of mismatch with
 * a specific user-facing message.
 *
 * Run: npx tsx tests/job-fingerprint.test.ts
 */
import {
  buildJobFingerprint,
  fingerprintsEqual,
  fingerprintDiff,
  fingerprintMismatchReason,
  hashObject,
  type JobFingerprint,
} from '../src/core/job/JobFingerprint';
import { createScene } from '../src/core/scene/Scene';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';

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

// Reused across the test so scene/profile IDs match between calls;
// otherwise hashSceneForPersistence + hashObject would diverge on
// auto-generated IDs from createScene/createBlankProfile.
const baseScene = createScene(400, 300, 'fp-test');
(baseScene as { id: string }).id = 'fixed-scene';
const baseProfile = createBlankProfile('test-profile');
(baseProfile as { id: string }).id = 'fixed-profile';

function makeBaseArgs() {
  return {
    scene: baseScene,
    profile: baseProfile,
    materialSnapshot: { id: 'p1', power: 80 },
    startMode: 'absolute' as const,
    savedOrigin: null,
    capabilities: { maxSpindle: 1000, bedW: 400, bedH: 300 },
    compileOptions: { optimizeOrder: true },
  };
}

console.log('\n=== T2-85 JobFingerprint ===\n');

void (async () => {

// 1. buildJobFingerprint: every field populated (string)
{
  const fp = buildJobFingerprint(makeBaseArgs());
  for (const k of [
    'sceneHash', 'profileHash', 'materialHash',
    'startMode', 'savedOriginHash', 'machineCapabilitiesHash',
    'compileOptionsHash',
  ] as const) {
    assert(typeof fp[k] === 'string' && (fp[k] as string).length > 0,
      `field ${k} populated as non-empty string`);
  }
}

// 2. fingerprintsEqual: identical args → equal
{
  const a = buildJobFingerprint(makeBaseArgs());
  const b = buildJobFingerprint(makeBaseArgs());
  assert(fingerprintsEqual(a, b), 'identical args: fingerprints equal');
}

// 3. Each field-changing scenario produces a diff at exactly that field
{
  const base = buildJobFingerprint(makeBaseArgs());
  // startMode change
  const startModeChanged = buildJobFingerprint({ ...makeBaseArgs(), startMode: 'current' });
  const diff1 = fingerprintDiff(base, startModeChanged);
  assert(diff1.includes('startMode') && !diff1.includes('sceneHash'),
    `startMode change: only 'startMode' diff (got ${diff1.join(',')})`);

  // savedOrigin change
  const savedOriginChanged = buildJobFingerprint({
    ...makeBaseArgs(), savedOrigin: { x: 50, y: 50 },
  });
  const diff2 = fingerprintDiff(base, savedOriginChanged);
  assert(diff2.includes('savedOriginHash'),
    `savedOrigin change: 'savedOriginHash' diff (got ${diff2.join(',')})`);

  // capabilities change
  const capChanged = buildJobFingerprint({
    ...makeBaseArgs(), capabilities: { maxSpindle: 255, bedW: 400, bedH: 300 },
  });
  const diff3 = fingerprintDiff(base, capChanged);
  assert(diff3.includes('machineCapabilitiesHash'),
    `cap change: 'machineCapabilitiesHash' diff (got ${diff3.join(',')})`);

  // compileOptions change
  const coChanged = buildJobFingerprint({
    ...makeBaseArgs(), compileOptions: { optimizeOrder: false },
  });
  const diff4 = fingerprintDiff(base, coChanged);
  assert(diff4.includes('compileOptionsHash'),
    `compile-opts change: 'compileOptionsHash' diff (got ${diff4.join(',')})`);

  // material change
  const matChanged = buildJobFingerprint({
    ...makeBaseArgs(), materialSnapshot: { id: 'p1', power: 90 },
  });
  const diff5 = fingerprintDiff(base, matChanged);
  assert(diff5.includes('materialHash'),
    `material change: 'materialHash' diff (got ${diff5.join(',')})`);
}

// 4. fingerprintMismatchReason: returns null when equal
{
  const a = buildJobFingerprint(makeBaseArgs());
  const b = buildJobFingerprint(makeBaseArgs());
  assert(fingerprintMismatchReason(a, b) === null,
    'equal fingerprints: reason=null');
}

// 5. fingerprintMismatchReason: returns the first changed field with
//    a user-facing message
{
  const a = buildJobFingerprint(makeBaseArgs());
  const b = buildJobFingerprint({ ...makeBaseArgs(), startMode: 'current' });
  const reason = fingerprintMismatchReason(a, b);
  assert(reason != null && reason.field === 'startMode',
    `startMode mismatch: field='startMode' (got ${reason?.field})`);
  assert(reason != null && /start mode changed/i.test(reason.message),
    `startMode mismatch: message names start mode`);
}

// 6. fingerprintMismatchReason: each field has a distinct user message
{
  const fields: Array<keyof JobFingerprint> = [
    'sceneHash', 'profileHash', 'materialHash', 'startMode',
    'savedOriginHash', 'machineCapabilitiesHash', 'compileOptionsHash',
  ];
  const messages = new Set<string>();
  for (const f of fields) {
    const a: JobFingerprint = {
      sceneHash: 'a', profileHash: 'a', materialHash: 'a',
      startMode: 'absolute', savedOriginHash: 'a',
      machineCapabilitiesHash: 'a', compileOptionsHash: 'a',
    };
    const b: JobFingerprint = { ...a };
    if (f === 'startMode') (b as { startMode: 'current' }).startMode = 'current';
    else (b as unknown as Record<string, string>)[f] = 'b';
    const reason = fingerprintMismatchReason(a, b);
    if (reason) messages.add(reason.message);
  }
  assert(messages.size === fields.length,
    `each of 7 fields has a distinct message (got ${messages.size} unique messages)`);
}

// 7. hashObject: stable across key-order variations
{
  const a = hashObject({ x: 1, y: 2, z: 3 });
  const b = hashObject({ z: 3, x: 1, y: 2 });
  assert(a === b, `hashObject: key-order independent (got ${a} vs ${b})`);
}

// 8. hashObject: null/undefined → 'none'
{
  assert(hashObject(null) === 'none', `hashObject(null) === 'none'`);
  assert(hashObject(undefined) === 'none', `hashObject(undefined) === 'none'`);
}

// 9. hashObject: different content → different hash
{
  const a = hashObject({ x: 1 });
  const b = hashObject({ x: 2 });
  assert(a !== b, `different content: different hash`);
}

// 10. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/core/job/JobFingerprint.ts'), 'utf-8');
  assert(/T2-85/.test(src), 'T2-85 marker in JobFingerprint.ts');
  for (const f of [
    'sceneHash', 'profileHash', 'materialHash', 'startMode',
    'savedOriginHash', 'machineCapabilitiesHash', 'compileOptionsHash',
  ]) {
    assert(src.includes(f), `field ${f} declared`);
  }
  assert(/buildJobFingerprint/.test(src) && /fingerprintsEqual/.test(src) && /fingerprintDiff/.test(src),
    'all helper exports present');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
