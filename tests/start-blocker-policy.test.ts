/**
 * PRT4040 safety-gate simplification: central StartBlocker policy.
 *
 * Run: npx tsx tests/start-blocker-policy.test.ts
 */
import {
  evaluateStartBlockers,
  firstStartBlocker,
  formatStartBlockerForError,
  type StartBlockerInput,
} from '../src/app/StartBlocker';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  fail - ${message}`);
  }
}

function baseInput(overrides: Partial<StartBlockerInput> = {}): StartBlockerInput {
  return {
    isConnected: true,
    machineStatus: 'idle',
    machineErrorCode: null,
    laserOutputState: 'off',
    activeOperation: null,
    safetyState: { kind: 'safeIdle' },
    placementUncertain: false,
    allowUnverifiedWcsStart: false,
    startMode: 'current',
    currentPositionConfirmed: true,
    ...overrides,
  };
}

console.log('\n=== PRT4040 start-blocker policy ===\n');

{
  const blockers = evaluateStartBlockers(baseInput());
  assert(firstStartBlocker(blockers) === null, 'safe idle input has no blocking StartBlocker');
}

{
  const blockers = evaluateStartBlockers(baseInput({
    safetyState: { kind: 'stoppedPositionUnknown', reason: 'soft reset requires position confirmation' },
  }));
  const blocker = firstStartBlocker(blockers);
  assert(blocker?.severity === 'recoverableBlock', 'stoppedPositionUnknown is recoverable, not a hard block');
  assert(blocker?.id === 'position-unknown', 'stoppedPositionUnknown maps to position-unknown blocker');
  assert(/Position needs confirmation/.test(blocker?.title ?? ''), 'copy names position confirmation');
  assert(!/not in a safe idle state/i.test(formatStartBlockerForError(blocker!)), 'copy does not claim machine is not idle');
}

{
  const blockers = evaluateStartBlockers(baseInput({
    machineStatus: 'alarm',
  }));
  const blocker = firstStartBlocker(blockers);
  assert(blocker?.severity === 'hardBlock', 'live GRBL alarm remains a hard block');
  assert(/alarm/.test(blocker?.message ?? ''), 'alarm block names the live controller status');
}

{
  const blockers = evaluateStartBlockers(baseInput({
    placementUncertain: true,
    allowUnverifiedWcsStart: true,
    startMode: 'current',
  }));
  assert(firstStartBlocker(blockers) === null, 'PRT4040 current-head WCS uncertainty is not a Start block');
  assert(blockers.some((b) => b.severity === 'warning' && b.id === 'wcs-unverified'), 'PRT4040 current-head WCS uncertainty is still visible as warning');
}

{
  const blockers = evaluateStartBlockers(baseInput({
    placementUncertain: true,
    allowUnverifiedWcsStart: true,
    startMode: 'savedOrigin',
  }));
  const blocker = firstStartBlocker(blockers);
  assert(blocker?.severity === 'hardBlock', 'saved-origin still blocks on unverified WCS');
}

{
  const blocker = firstStartBlocker(evaluateStartBlockers(baseInput({
    currentPositionConfirmed: false,
    startMode: 'current',
  })));
  assert(blocker?.id === 'current-position-unconfirmed', 'current-head keeps relative-mode position proof hard block');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
