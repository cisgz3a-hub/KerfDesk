/**
 * T1-172 (audit F-017): the per-line delay (ms) inserted between
 * G-code lines in `ExecutionCoordinator.runFrame` must be profile-
 * driven instead of hardcoded.
 *
 * Pre-T1-172 `runFrame` passed `lineDelayMs: 50` to
 * `ctrl.operations.frame(...)` unconditionally. At 8 frame corners
 * (4 outline + 4 crosshair arms) that's 400 ms of inserted delay
 * regardless of feedrate. Fast firmware (Falcon A1 Pro at high
 * baud) needs less; slow / shared-buffer firmware may need more.
 * The audit (docs/AUDIT-2026-05-11.md F-017) flagged this as
 * Low-severity Performance / Robustness.
 *
 * Post-T1-172:
 *  - `DeviceProfile.frameLineDelayMs?: number` — optional override.
 *  - `DEFAULT_FRAME_LINE_DELAY_MS = 50` — exported constant.
 *  - `resolveFrameLineDelayMs(profile)` — reads the field; accepts 0
 *    (disable delay) explicitly; falls back to the default on
 *    null / undefined / non-finite / negative.
 *  - `validateProfile` rejects negative / non-finite values.
 *  - `ExecutionCoordinator.frameSafe` / `frameDot` / `runFrame`
 *    accept an optional `frameLineDelayMs?: number` arg. When
 *    omitted, the coordinator falls back to 50 (preserves shipped
 *    behavior — call sites that don't pass the value see no change).
 *  - `ConnectionPanelMain.tsx` resolves the profile's value and
 *    passes it into both frame calls.
 *
 * Run: npx tsx tests/frame-line-delay-profile-driven.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FRAME_LINE_DELAY_MS,
  resolveFrameLineDelayMs,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import { validateProfile } from '../src/core/devices/validateProfile';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-172 frame line-delay is profile-driven ===\n');

// -------- 1. Constant has the documented default value --------
{
  assert(
    DEFAULT_FRAME_LINE_DELAY_MS === 50,
    `DEFAULT_FRAME_LINE_DELAY_MS === 50 (got ${DEFAULT_FRAME_LINE_DELAY_MS})`,
  );
}

// -------- 2. resolveFrameLineDelayMs: defaults --------
{
  assert(resolveFrameLineDelayMs(null) === 50, 'resolveFrameLineDelayMs(null) → 50');
  assert(resolveFrameLineDelayMs(undefined) === 50, 'resolveFrameLineDelayMs(undefined) → 50');
  assert(resolveFrameLineDelayMs({}) === 50, 'resolveFrameLineDelayMs({}) → 50');
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: undefined }) === 50, 'unset field → 50');
}

// -------- 3. resolveFrameLineDelayMs: profile overrides --------
{
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: 10 }) === 10, 'fast firmware: 10 ms override');
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: 100 }) === 100, 'slow firmware: 100 ms override');
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: 0 }) === 0, '0 disables delay (explicit zero accepted)');
}

// -------- 4. resolveFrameLineDelayMs: invalid values fall back --------
{
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: -5 } as unknown as DeviceProfile) === 50, 'negative → fallback');
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: Number.NaN } as unknown as DeviceProfile) === 50, 'NaN → fallback');
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: Number.POSITIVE_INFINITY } as unknown as DeviceProfile) === 50, 'Infinity → fallback');
  assert(resolveFrameLineDelayMs({ frameLineDelayMs: 'fast' } as unknown as DeviceProfile) === 50, 'string → fallback');
}

// -------- 5. validateProfile flags invalid values --------
function makeBaseProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    id: 'p',
    name: 'p',
    createdAt: '2026-01-01T00:00:00.000Z',
    bedWidth: 400,
    bedHeight: 300,
    originCorner: 'front-left',
    maxFeedRate: 6000,
    maxSpindle: 1000,
    homingEnabled: false,
    softLimitsEnabled: false,
    invertY: false,
    returnToOrigin: true,
    baudRate: 115200,
    startGcode: '',
    endGcode: '',
    ...overrides,
  } as unknown as DeviceProfile;
}

{
  const validZero = validateProfile(makeBaseProfile({ frameLineDelayMs: 0 }));
  const negativeIssues = validateProfile(makeBaseProfile({ frameLineDelayMs: -1 })).issues
    .filter(i => i.field === 'frameLineDelayMs');
  const nanIssues = validateProfile(makeBaseProfile({ frameLineDelayMs: Number.NaN })).issues
    .filter(i => i.field === 'frameLineDelayMs');

  assert(
    validZero.issues.find(i => i.field === 'frameLineDelayMs') === undefined,
    'validateProfile accepts frameLineDelayMs === 0',
  );
  assert(
    negativeIssues.length === 1 && negativeIssues[0].severity === 'error',
    'validateProfile rejects negative frameLineDelayMs (1 error)',
  );
  assert(
    nanIssues.length === 1 && nanIssues[0].severity === 'error',
    'validateProfile rejects non-finite frameLineDelayMs (1 error)',
  );
  if (negativeIssues[0]) {
    assert(
      negativeIssues[0].code === 'PROFILE_FRAME_LINE_DELAY_MS_INVALID',
      `negative error code === 'PROFILE_FRAME_LINE_DELAY_MS_INVALID' (got ${negativeIssues[0].code})`,
    );
  }
}

// -------- 6. Source pins on the ExecutionCoordinator threading --------
{
  const ecSrc = readFileSync(resolve(here, '../src/app/ExecutionCoordinator.ts'), 'utf-8');
  assert(/T1-172/.test(ecSrc), 'ExecutionCoordinator carries T1-172 marker');
  assert(/audit F-017/.test(ecSrc), 'ExecutionCoordinator cross-references audit F-017');
  assert(
    /lineDelayMs:\s*args\.frameLineDelayMs\s*\?\?\s*50/.test(ecSrc),
    'ExecutionCoordinator passes args.frameLineDelayMs ?? 50 to ctrl.operations.frame',
  );
  // The old hardcoded literal must be gone.
  assert(
    !/lineDelayMs:\s*50,?\s*\}\s*\)/m.test(ecSrc),
    'ExecutionCoordinator no longer passes a bare `lineDelayMs: 50,` literal',
  );
  // frameSafe / frameDot / runFrame each accept the new optional arg.
  const argCounts = ecSrc.match(/frameLineDelayMs\?:\s*number/g);
  assert(
    argCounts !== null && argCounts.length >= 3,
    `frameLineDelayMs?: number declared in at least 3 signatures (frameSafe, frameDot, runFrame). Got ${argCounts?.length ?? 0}`,
  );
}

// -------- 7. Source pins on ConnectionPanelMain wiring --------
{
  const cpSrc = readFileSync(resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
  assert(
    /resolveFrameLineDelayMs/.test(cpSrc),
    'ConnectionPanelMain imports resolveFrameLineDelayMs',
  );
  // Both frame call sites pass the resolved value.
  const callsWithDelay = cpSrc.match(/frameLineDelayMs[,\s}]/g);
  assert(
    callsWithDelay !== null && callsWithDelay.length >= 4, // 2x declaration + 2x pass-in
    `frameLineDelayMs referenced in ConnectionPanelMain >= 4 times (2 declarations + 2 call-site forwards). Got ${callsWithDelay?.length ?? 0}`,
  );
}

// -------- 8. Source pins on the DeviceProfile module --------
{
  const dpSrc = readFileSync(resolve(here, '../src/core/devices/DeviceProfile.ts'), 'utf-8');
  assert(/T1-172/.test(dpSrc), 'DeviceProfile.ts carries T1-172 marker');
  assert(/audit F-017/.test(dpSrc), 'DeviceProfile.ts cross-references audit F-017');
  assert(
    /export const DEFAULT_FRAME_LINE_DELAY_MS\s*=\s*50/.test(dpSrc),
    'DEFAULT_FRAME_LINE_DELAY_MS exported with value 50',
  );
  assert(
    /export function resolveFrameLineDelayMs\b/.test(dpSrc),
    'resolveFrameLineDelayMs exported',
  );
  assert(
    /frameLineDelayMs\?:\s*number/.test(dpSrc),
    'DeviceProfile interface declares frameLineDelayMs?: number',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
