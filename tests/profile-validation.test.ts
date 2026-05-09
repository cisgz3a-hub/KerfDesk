/**
 * T2-39: strict profile validation on save.
 *
 * Pre-T2-39, profiles with bedWidth=0 / maxSpindle=NaN / originCorner=
 * gibberish / autoFocusCommand="M3 S1000" were silently accepted by
 * `saveDeviceProfile`. Each one produced downstream nonsense (gcode
 * stream with NaN S-values, transform corner mismatch, laser fired
 * unattended via autofocus). T2-39 adds `validateProfile()` and wires
 * it into the save path: hard errors throw `ProfileValidationError`
 * with the per-field issues; warnings log but allow save.
 *
 * Run: npx tsx tests/profile-validation.test.ts
 */
import {
  validateProfile,
  type ProfileValidationResult,
} from '../src/core/devices/validateProfile';
import {
  saveDeviceProfile,
  ProfileValidationError,
  createBlankProfile,
} from '../src/core/devices/DeviceProfile';
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

console.log('\n=== T2-39 strict profile validation on save ===\n');

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length(): number { return Object.keys(memoryStore).length; },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
};

async function run(): Promise<void> {

function findIssue(r: ProfileValidationResult, field: string): boolean {
  return r.issues.some(i => i.field === field && i.severity === 'error');
}

function freshValid(): DeviceProfile {
  const p = createBlankProfile('T2-39 test');
  p.bedWidth = 300;
  p.bedHeight = 200;
  p.maxSpindle = 1000;
  p.maxFeedRate = 6000;
  p.baudRate = 115200;
  p.originCorner = 'front-left';
  p.homeCorner = 'front-left';
  p.watts = 5;
  return p;
}

// ── 1. Valid profile passes ──
{
  const r = validateProfile(freshValid());
  assert(r.ok, `valid profile passes (got ${r.issues.length} issues)`);
}

// ── 2. bedWidth = 0 → rejected ──
{
  const p = freshValid();
  p.bedWidth = 0;
  const r = validateProfile(p);
  assert(!r.ok, 'bedWidth=0 rejected');
  assert(findIssue(r, 'bedWidth'), 'bedWidth issue raised');
}

// ── 3. bedWidth negative → rejected ──
{
  const p = freshValid();
  p.bedWidth = -100;
  const r = validateProfile(p);
  assert(!r.ok, 'bedWidth=-100 rejected');
}

// ── 4. bedWidth > 5000 (sanity ceiling) → rejected ──
{
  const p = freshValid();
  p.bedWidth = 10000;
  const r = validateProfile(p);
  assert(!r.ok, 'bedWidth=10000 (above 5m ceiling) rejected');
}

// ── 5. maxSpindle = NaN → rejected ──
{
  const p = freshValid();
  p.maxSpindle = NaN;
  const r = validateProfile(p);
  assert(!r.ok, 'maxSpindle=NaN rejected');
  assert(findIssue(r, 'maxSpindle'), 'maxSpindle issue raised for NaN');
}

// ── 6. maxSpindle = Infinity → rejected ──
{
  const p = freshValid();
  p.maxSpindle = Infinity;
  const r = validateProfile(p);
  assert(!r.ok, 'maxSpindle=Infinity rejected');
}

// ── 7. maxSpindle = 0 → rejected (no engraving possible) ──
{
  const p = freshValid();
  p.maxSpindle = 0;
  const r = validateProfile(p);
  assert(!r.ok, 'maxSpindle=0 rejected');
}

// ── 8. maxSpindle > 65535 (PWM ceiling) → rejected ──
{
  const p = freshValid();
  p.maxSpindle = 100000;
  const r = validateProfile(p);
  assert(!r.ok, 'maxSpindle above 65535 PWM ceiling rejected');
}

// ── 9. originCorner = gibberish → rejected ──
{
  const p = freshValid();
  // Force-cast to bypass the type system (simulates storage edit / migration).
  (p as unknown as { originCorner: string }).originCorner = 'upside-down';
  const r = validateProfile(p);
  assert(!r.ok, 'originCorner="upside-down" rejected');
  assert(findIssue(r, 'originCorner'), 'originCorner issue raised');
}

// ── 10. All four valid origin corners pass ──
{
  for (const corner of ['front-left', 'rear-left', 'front-right', 'rear-right'] as const) {
    const p = freshValid();
    p.originCorner = corner;
    const r = validateProfile(p);
    assert(r.ok, `originCorner=${corner} accepted`);
  }
}

{
  const p = freshValid();
  // Force-cast to bypass the type system (simulates storage edit / migration).
  (p as unknown as { homeCorner: string }).homeCorner = 'sideways';
  const r = validateProfile(p);
  assert(!r.ok, 'homeCorner="sideways" rejected');
  assert(findIssue(r, 'homeCorner'), 'homeCorner issue raised');
}

{
  for (const corner of ['front-left', 'rear-left', 'front-right', 'rear-right'] as const) {
    const p = freshValid();
    p.homeCorner = corner;
    const r = validateProfile(p);
    assert(r.ok, `homeCorner=${corner} accepted`);
  }
}

// ── 11. baudRate = unrecognized value → rejected ──
{
  const p = freshValid();
  p.baudRate = 12345;
  const r = validateProfile(p);
  assert(!r.ok, 'baudRate=12345 rejected');
  assert(findIssue(r, 'baudRate'), 'baudRate issue raised');
}

// ── 12. autoFocusCommand contains $X → rejected ──
{
  const p = freshValid();
  p.autoFocusCommand = '$X';
  const r = validateProfile(p);
  assert(!r.ok, 'autoFocusCommand="$X" rejected (alarm-clear without consent)');
  assert(findIssue(r, 'autoFocusCommand'), 'autoFocusCommand issue raised');
}

// ── 13. autoFocusCommand contains M3 S1000 → rejected ──
{
  const p = freshValid();
  p.autoFocusCommand = 'M3 S1000';
  const r = validateProfile(p);
  assert(!r.ok, 'autoFocusCommand="M3 S1000" rejected (laser-on outside test-fire)');
}

// ── 14. autoFocusCommand contains G10 → rejected ──
{
  const p = freshValid();
  p.autoFocusCommand = 'G10 L2 P1 X0 Y0';
  const r = validateProfile(p);
  assert(!r.ok, 'autoFocusCommand with G10 rejected (silent WCS rewrite)');
}

// ── 15. Legitimate autoFocusCommand passes (e.g. $HZ1 for Falcon) ──
{
  const p = freshValid();
  p.autoFocusCommand = '$HZ1';
  const r = validateProfile(p);
  assert(r.ok, 'autoFocusCommand="$HZ1" (Falcon autofocus) accepted');
}

// ── 16. autoFocusTimeoutMs > 5 minutes → rejected ──
{
  const p = freshValid();
  p.autoFocusTimeoutMs = 10 * 60 * 1000;
  const r = validateProfile(p);
  assert(!r.ok, 'autoFocusTimeoutMs > 5 minutes rejected');
}

// ── 17. autoFocusTimeoutMs = -1 → rejected ──
{
  const p = freshValid();
  p.autoFocusTimeoutMs = -1;
  const r = validateProfile(p);
  assert(!r.ok, 'autoFocusTimeoutMs=-1 rejected');
}

// ── 18. maxFeedRate negative → rejected ──
{
  const p = freshValid();
  p.maxFeedRate = -100;
  const r = validateProfile(p);
  assert(!r.ok, 'maxFeedRate negative rejected');
}

// ── 19. blank name → rejected ──
{
  const p = freshValid();
  p.name = '';
  const r = validateProfile(p);
  assert(!r.ok, 'blank name rejected');
}

// ── 20. watts = NaN → warning (not error) ──
{
  const p = freshValid();
  p.watts = NaN;
  const r = validateProfile(p);
  // NaN watts is a warning, not error; r.ok stays true.
  assert(r.ok, 'watts=NaN does NOT block save (warning only)');
  assert(
    r.issues.some(i => i.field === 'watts' && i.severity === 'warning'),
    'watts=NaN raises a warning-severity issue',
  );
}

// ── 21. saveDeviceProfile throws ProfileValidationError on hard errors ──
{
  const p = freshValid();
  p.bedWidth = 0;
  let caught: unknown = null;
  try {
    saveDeviceProfile(p);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof ProfileValidationError,
    'saveDeviceProfile throws ProfileValidationError on hard error');
  if (caught instanceof ProfileValidationError) {
    assert(caught.issues.some(i => i.field === 'bedWidth'),
      'thrown error.issues includes the failing field');
  }
}

// ── 22. saveDeviceProfile succeeds for valid profile ──
{
  const p = freshValid();
  p.id = 'test-valid-' + Date.now();
  let threw = false;
  try {
    saveDeviceProfile(p);
  } catch {
    threw = true;
  }
  assert(!threw, 'saveDeviceProfile accepts a valid profile');
}

// ── 23. Source-level pin: T2-39 marker + integration ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const validatorSrc = fs.readFileSync(
    path.resolve(here, '../src/core/devices/validateProfile.ts'),
    'utf-8',
  );
  assert(/T2-39/.test(validatorSrc), 'T2-39 marker in validateProfile.ts');
  assert(/export function validateProfile/.test(validatorSrc),
    'validateProfile function exported');
  assert(/MAX_SPINDLE = 65535/.test(validatorSrc),
    '16-bit PWM ceiling constant declared');

  const profileSrc = fs.readFileSync(
    path.resolve(here, '../src/core/devices/DeviceProfile.ts'),
    'utf-8',
  );
  assert(/T2-39/.test(profileSrc), 'T2-39 marker in DeviceProfile.ts');
  assert(/throw new ProfileValidationError/.test(profileSrc),
    'saveDeviceProfile throws ProfileValidationError on hard errors');
  assert(/export class ProfileValidationError extends Error/.test(profileSrc),
    'ProfileValidationError exported');
  assert(/import \{ validateProfile/.test(profileSrc),
    'validateProfile imported into DeviceProfile.ts');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
