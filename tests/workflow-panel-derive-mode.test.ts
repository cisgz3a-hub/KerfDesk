/**
 * T1-204: regression test for the pure `derivePanelMode` helper.
 *
 * `derivePanelMode` is the single source of truth for which mode the
 * new `WorkflowPanel` renders. It's deliberately a pure function so
 * the precedence rules can be tested exhaustively without React.
 *
 * Precedence (top-down — first match wins, per the docstring in
 * `src/ui/components/workflow/derivePanelMode.ts`):
 *
 *   1. !isConnected + isConnecting → 'connecting'
 *   2. !isConnected → 'disconnected'
 *   3. recoveryState.status !== 'none' → 'recovery'
 *   4. machineStatus === 'alarm' → 'recovery'
 *   5. machineStatus === 'faulted_requires_inspection' → 'recovery'
 *   6. machineStatus === 'run' → 'running'
 *   7. machineStatus === 'hold' → 'paused'
 *   8. canStartJob → 'ready'
 *   9. fallthrough → 'setup'
 *
 * Run: npx tsx tests/workflow-panel-derive-mode.test.ts
 */
import {
  derivePanelMode,
  panelModeLabel,
  type PanelMode,
  type PanelModeInput,
} from '../src/ui/components/workflow/derivePanelMode';
import type { RecoveryState } from '../src/runtime/RecoveryState';

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

const idleRecovery: RecoveryState = { status: 'none' };
const activeRecovery: RecoveryState = {
  status: 'alarm',
  alarmCode: 1,
  occurredAt: 0,
  requiresRehome: true,
  inspectionDone: false,
  unlockDone: false,
  rehomeDone: false,
  reframeDone: false,
};

function input(over: Partial<PanelModeInput>): PanelModeInput {
  return {
    isConnected: true,
    isConnecting: false,
    machineStatus: 'idle',
    recoveryState: idleRecovery,
    canStartJob: false,
    ...over,
  };
}

console.log('\n=== T1-204 derivePanelMode ===\n');

// -------- 1. Connection precedence --------
{
  assert(
    derivePanelMode(input({ isConnected: false, isConnecting: false })) === 'disconnected',
    "!isConnected + !isConnecting → 'disconnected'",
  );
  assert(
    derivePanelMode(input({ isConnected: false, isConnecting: true })) === 'connecting',
    "!isConnected + isConnecting → 'connecting'",
  );
  // isConnecting is IGNORED when isConnected is true — connection-
  // state precedence is by 'connected' boolean, not the in-flight flag.
  assert(
    derivePanelMode(input({ isConnected: true, isConnecting: true })) !== 'connecting',
    'isConnected=true overrides isConnecting',
  );
}

// -------- 2. Recovery is a hard lock --------
{
  assert(
    derivePanelMode(input({ recoveryState: activeRecovery })) === 'recovery',
    "recoveryState.status !== 'none' → 'recovery'",
  );
  // Recovery beats running.
  assert(
    derivePanelMode(input({ recoveryState: activeRecovery, machineStatus: 'run' })) === 'recovery',
    "recovery beats machineStatus 'run'",
  );
  // Recovery beats paused.
  assert(
    derivePanelMode(input({ recoveryState: activeRecovery, machineStatus: 'hold' })) === 'recovery',
    "recovery beats machineStatus 'hold'",
  );
  // Recovery beats ready.
  assert(
    derivePanelMode(input({ recoveryState: activeRecovery, canStartJob: true })) === 'recovery',
    'recovery beats canStartJob',
  );
}

// -------- 3. Alarm + fault map to recovery (per the design) --------
{
  assert(
    derivePanelMode(input({ machineStatus: 'alarm' })) === 'recovery',
    "machineStatus 'alarm' → 'recovery'",
  );
  assert(
    derivePanelMode(input({ machineStatus: 'faulted_requires_inspection' })) === 'recovery',
    "machineStatus 'faulted_requires_inspection' → 'recovery'",
  );
}

// -------- 4. Job lifecycle --------
{
  assert(
    derivePanelMode(input({ machineStatus: 'run' })) === 'running',
    "machineStatus 'run' → 'running'",
  );
  assert(
    derivePanelMode(input({ machineStatus: 'hold' })) === 'paused',
    "machineStatus 'hold' → 'paused'",
  );
  // Both override ready.
  assert(
    derivePanelMode(input({ machineStatus: 'run', canStartJob: true })) === 'running',
    "machineStatus 'run' beats canStartJob",
  );
  assert(
    derivePanelMode(input({ machineStatus: 'hold', canStartJob: true })) === 'paused',
    "machineStatus 'hold' beats canStartJob",
  );
}

// -------- 5. Ready vs setup at idle --------
{
  assert(
    derivePanelMode(input({ machineStatus: 'idle', canStartJob: true })) === 'ready',
    "idle + canStartJob=true → 'ready'",
  );
  assert(
    derivePanelMode(input({ machineStatus: 'idle', canStartJob: false })) === 'setup',
    "idle + canStartJob=false → 'setup'",
  );
  // Status 'homing' or 'check' (the residual MachineStatus values
  // that aren't run/hold/alarm/fault) still fall through to setup.
  assert(
    derivePanelMode(input({ machineStatus: 'homing', canStartJob: false })) === 'setup',
    "'homing' status → 'setup'",
  );
  assert(
    derivePanelMode(input({ machineStatus: 'check', canStartJob: false })) === 'setup',
    "'check' status → 'setup'",
  );
  // Even with canStartJob=true, non-idle non-job statuses fall through
  // (canStartJob is meaningful only when the machine is at rest).
  assert(
    derivePanelMode(input({ machineStatus: 'homing', canStartJob: true })) === 'ready',
    "'homing' + canStartJob=true → 'ready' (current rule — caller must gate)",
  );
}

// -------- 5b. T1-209 follow-up: optimistic pauseRequested --------
//
// Pre-fix the UI sat in 'running' mode for the ~100-500ms streaming
// queue lag between Pause click and the controller actually
// reporting Hold:0. With pauseRequested the panel flips immediately.
{
  // pauseRequested + machineStatus='run' → 'paused' (optimistic).
  assert(
    derivePanelMode(input({ machineStatus: 'run', pauseRequested: true })) === 'paused',
    "pauseRequested=true + machineStatus='run' → 'paused' (optimistic flip)",
  );
  // pauseRequested without an active job has no effect: idle stays idle.
  assert(
    derivePanelMode(input({ machineStatus: 'idle', pauseRequested: true })) !== 'paused',
    'pauseRequested with idle status does NOT flip to paused (only meaningful while running)',
  );
  // pauseRequested doesn't override recovery — safety first.
  assert(
    derivePanelMode(input({
      machineStatus: 'run',
      pauseRequested: true,
      recoveryState: activeRecovery,
    })) === 'recovery',
    'recovery beats pauseRequested',
  );
  // pauseRequested=false matches the original behaviour.
  assert(
    derivePanelMode(input({ machineStatus: 'run', pauseRequested: false })) === 'running',
    "pauseRequested=false → still 'running'",
  );
}

// -------- 6. Mutual exclusion (every input → exactly one mode) --------
{
  const statuses = [
    'idle', 'run', 'hold', 'alarm', 'check', 'homing',
    'faulted_requires_inspection', 'disconnected', 'connecting',
  ] as const;
  const validModes: ReadonlySet<PanelMode> = new Set([
    'disconnected', 'connecting', 'recovery',
    'setup', 'ready', 'running', 'paused',
  ]);
  for (const status of statuses) {
    for (const canStartJob of [true, false]) {
      for (const isConnected of [true, false]) {
        for (const isConnecting of [true, false]) {
          const mode = derivePanelMode({
            isConnected,
            isConnecting,
            machineStatus: status,
            recoveryState: idleRecovery,
            canStartJob,
          });
          if (!validModes.has(mode)) {
            assert(false, `produced invalid mode '${mode}' for input ${JSON.stringify({ status, canStartJob, isConnected, isConnecting })}`);
          }
        }
      }
    }
  }
  assert(true, 'mutual exclusion: every input produces exactly one of the 7 modes');
}

// -------- 7. panelModeLabel covers every mode --------
{
  const modes: ReadonlyArray<PanelMode> = [
    'disconnected', 'connecting', 'recovery',
    'setup', 'ready', 'running', 'paused',
  ];
  const labels = new Set(modes.map(panelModeLabel));
  assert(labels.size === modes.length, 'every mode has a distinct label');
  for (const mode of modes) {
    const label = panelModeLabel(mode);
    assert(label.length > 0, `'${mode}' has a non-empty label ('${label}')`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
