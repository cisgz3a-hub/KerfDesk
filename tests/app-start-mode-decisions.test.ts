/**
 * T2-6 Phase 3y: regression test for the two pure startMode
 * predicates extracted from App.tsx's auto-switch useEffects.
 *
 * Pre-Phase-3y both decisions were inline AND chains inside their
 * useEffect bodies. Extracting them makes every corner case
 * exhaustively testable without mounting the full App.tsx render
 * tree.
 *
 * `shouldResetStartModeAfterDisconnect` returns true when ALL three
 * conditions hold:
 *   - machine status is 'disconnected'
 *   - current startMode is 'current'
 *   - active profile does NOT default to current-mode
 *
 * `shouldNudgeStartModeToCurrent` returns true when BOTH hold:
 *   - active profile defaults to current-mode
 *     (currently: PRT4040 router-laser profiles)
 *   - current startMode is 'absolute'
 *
 * Run: npx tsx tests/app-start-mode-decisions.test.ts
 */
import {
  shouldResetStartModeAfterDisconnect,
  shouldNudgeStartModeToCurrent,
} from '../src/ui/components/app/appStartModeDecisions';
import {
  createBlankProfile,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';

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

// PRT4040 profile is the only profile flagged by
// `shouldDefaultStartModeToCurrentForProfile`. Use a real one.
function prt4040Profile(): DeviceProfile {
  return { ...createBlankProfile('PRT4040'), brand: 'PRTCNC', model: 'PRT4040' };
}

function regularProfile(): DeviceProfile {
  return { ...createBlankProfile('Falcon A1 Pro'), brand: 'Sculpfun', model: 'Falcon A1 Pro' };
}

console.log('\n=== T2-6 Phase 3y appStartModeDecisions ===\n');

// -------- 1. shouldResetStartModeAfterDisconnect: happy path --------
{
  assert(
    shouldResetStartModeAfterDisconnect({
      machineStatus: 'disconnected',
      currentStartMode: 'current',
      activeProfile: regularProfile(),
    }) === true,
    "disconnected + current + non-PRT4040 profile → reset",
  );
}

// -------- 2. PRT4040 profile keeps 'current' on disconnect --------
{
  assert(
    shouldResetStartModeAfterDisconnect({
      machineStatus: 'disconnected',
      currentStartMode: 'current',
      activeProfile: prt4040Profile(),
    }) === false,
    "disconnected + current + PRT4040 profile → keep (don't reset)",
  );
}

// -------- 3. Non-disconnected statuses leave startMode alone --------
{
  for (const status of ['idle', 'run', 'hold', 'alarm', 'connecting'] as const) {
    assert(
      shouldResetStartModeAfterDisconnect({
        machineStatus: status,
        currentStartMode: 'current',
        activeProfile: regularProfile(),
      }) === false,
      `status='${status}' + current → no reset (only 'disconnected' triggers)`,
    );
  }
}

// -------- 4. startMode other than 'current' is never reset --------
{
  for (const mode of ['absolute', 'savedOrigin'] as const) {
    assert(
      shouldResetStartModeAfterDisconnect({
        machineStatus: 'disconnected',
        currentStartMode: mode,
        activeProfile: regularProfile(),
      }) === false,
      `startMode='${mode}' on disconnect → no reset (only 'current' resets)`,
    );
  }
}

// -------- 5. null/undefined inputs are safe --------
{
  assert(
    shouldResetStartModeAfterDisconnect({
      machineStatus: null,
      currentStartMode: 'current',
      activeProfile: regularProfile(),
    }) === false,
    'null machineStatus → no reset',
  );
  assert(
    shouldResetStartModeAfterDisconnect({
      machineStatus: 'disconnected',
      currentStartMode: 'current',
      activeProfile: null,
    }) === true,
    'null activeProfile → reset (profile-specific carve-out absent)',
  );
}

// -------- 6. shouldNudgeStartModeToCurrent: happy path --------
{
  assert(
    shouldNudgeStartModeToCurrent({
      activeProfile: prt4040Profile(),
      currentStartMode: 'absolute',
    }) === true,
    'PRT4040 profile + absolute → nudge to current',
  );
}

// -------- 7. Non-PRT4040 profiles never get the nudge --------
{
  assert(
    shouldNudgeStartModeToCurrent({
      activeProfile: regularProfile(),
      currentStartMode: 'absolute',
    }) === false,
    'non-PRT4040 + absolute → no nudge',
  );
  assert(
    shouldNudgeStartModeToCurrent({
      activeProfile: null,
      currentStartMode: 'absolute',
    }) === false,
    'null profile + absolute → no nudge',
  );
}

// -------- 8. startMode other than 'absolute' is left alone --------
{
  for (const mode of ['current', 'savedOrigin'] as const) {
    assert(
      shouldNudgeStartModeToCurrent({
        activeProfile: prt4040Profile(),
        currentStartMode: mode,
      }) === false,
      `PRT4040 + startMode='${mode}' → no nudge (only 'absolute' is nudged)`,
    );
  }
}

// -------- 9. Behaviour preservation: matches the pre-extraction
//             AND chains.
// Reset: machineStatus === 'disconnected' && startMode === 'current'
//        && !shouldDefaultStartModeToCurrentForProfile(profile)
// Nudge: shouldDefaultStartModeToCurrentForProfile(profile) &&
//        startMode === 'absolute'
{
  const matrix = [
    // reset matrix
    { fn: 'reset' as const, st: 'disconnected', sm: 'current',    p: regularProfile(), expect: true },
    { fn: 'reset' as const, st: 'disconnected', sm: 'current',    p: prt4040Profile(), expect: false },
    { fn: 'reset' as const, st: 'idle',         sm: 'current',    p: regularProfile(), expect: false },
    { fn: 'reset' as const, st: 'disconnected', sm: 'absolute',   p: regularProfile(), expect: false },
    // nudge matrix
    { fn: 'nudge' as const, st: 'idle',         sm: 'absolute',   p: prt4040Profile(), expect: true },
    { fn: 'nudge' as const, st: 'idle',         sm: 'absolute',   p: regularProfile(), expect: false },
    { fn: 'nudge' as const, st: 'idle',         sm: 'current',    p: prt4040Profile(), expect: false },
    { fn: 'nudge' as const, st: 'idle',         sm: 'savedOrigin', p: prt4040Profile(), expect: false },
  ];
  for (const c of matrix) {
    const actual = c.fn === 'reset'
      ? shouldResetStartModeAfterDisconnect({
          machineStatus: c.st as never,
          currentStartMode: c.sm as never,
          activeProfile: c.p,
        })
      : shouldNudgeStartModeToCurrent({
          activeProfile: c.p,
          currentStartMode: c.sm as never,
        });
    assert(
      actual === c.expect,
      `${c.fn} (status=${c.st}, mode=${c.sm}, profile=${c.p.model}) → ${c.expect}`,
    );
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
