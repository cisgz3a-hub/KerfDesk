/**
 * T1-30: centralized `computeCommandGates` helper produces a single map
 * of base-safety gates. Replaces ~ten ad-hoc `isConnected && !isRunning`
 * checks scattered across the UI. Pure function — exercise every
 * combination of state inputs.
 *
 * Run: npx tsx tests/command-gates-honor-safety-state.test.ts
 */
import {
  computeCommandGates,
  type CommandGatesInput,
} from '../src/app/computeCommandGates';
import type { MachineState } from '../src/controllers/ControllerInterface';
import type { ActiveOperationState } from '../src/app/MachineService';

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

console.log('\n=== T1-30 computeCommandGates ===\n');

async function run(): Promise<void> {

const idleState: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function input(overrides: Partial<CommandGatesInput> = {}): CommandGatesInput {
  return {
    state: idleState,
    laserOutput: 'off',
    activeOperation: null,
    recoveryPending: false,
    ...overrides,
  };
}

// 1. Baseline: idle + off + no op + no error + no recovery → all base-safe gates true
{
  const g = computeCommandGates(input());
  assert(g.baseSafe, 'baseline: baseSafe = true');
  assert(g.canJog, 'baseline: canJog = true');
  assert(g.canFrameSafe, 'baseline: canFrameSafe = true');
  assert(g.canFrameDot, 'baseline: canFrameDot = true');
  assert(g.canTestFire, 'baseline: canTestFire = true');
  assert(!g.canPause, 'baseline: canPause = false (only when running)');
  assert(!g.canResume, 'baseline: canResume = false (only when hold)');
  assert(g.canStop, 'baseline: canStop = true (connected)');
  assert(g.canEmergencyStop, 'baseline: canEmergencyStop = true');
  assert(!g.canUnlock, 'baseline: canUnlock = false (only when alarm)');
}

// 2. Status === 'run' → baseSafe gates false; canPause true
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'run' },
  }));
  assert(!g.baseSafe, 'run: baseSafe = false');
  assert(!g.canJog, 'run: canJog = false');
  assert(!g.canFrameSafe, 'run: canFrameSafe = false');
  assert(!g.canTestFire, 'run: canTestFire = false');
  assert(g.canPause, 'run: canPause = true');
  assert(g.canStop, 'run: canStop = true (still connected)');
}

// 3. Status === 'hold' → canResume true; baseSafe false
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'hold' },
  }));
  assert(!g.baseSafe, 'hold: baseSafe = false');
  assert(g.canResume, 'hold: canResume = true');
  assert(!g.canPause, 'hold: canPause = false');
  assert(g.canStop, 'hold: canStop = true');
}

// 3b. Status === 'jog' blocks unsafe actions until fresh Idle.
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'jog' },
  }));
  assert(!g.baseSafe, 'jog: baseSafe = false');
  assert(!g.canJog, 'jog: canJog = false until a fresh Idle arrives');
  assert(!g.canFrameSafe, 'jog: canFrameSafe = false');
  assert(!g.canFrameDot, 'jog: canFrameDot = false');
  assert(!g.canTestFire, 'jog: canTestFire = false');
  assert(g.canPause, 'jog: canPause = true');
  assert(g.canStop, 'jog: canStop = true');
}

// 4. Status === 'alarm' → only canStop / canEmergencyStop / canUnlock true
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'alarm', alarmCode: 1 },
  }));
  assert(!g.baseSafe, 'alarm: baseSafe = false');
  assert(!g.canFrameSafe, 'alarm: canFrameSafe = false');
  assert(!g.canTestFire, 'alarm: canTestFire = false');
  assert(g.canStop, 'alarm: canStop = true (recovery path)');
  assert(g.canEmergencyStop, 'alarm: canEmergencyStop = true');
  assert(g.canUnlock, 'alarm: canUnlock = true ($X recovers)');
  assert(!g.canPause, 'alarm: canPause = false');
  assert(!g.canResume, 'alarm: canResume = false');
}

// 5. Status === 'disconnected' → no gates fire (canStop false because nothing to stop)
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'disconnected' },
  }));
  assert(!g.baseSafe, 'disconnected: baseSafe = false');
  assert(!g.canStop, 'disconnected: canStop = false (nothing to stop)');
  assert(!g.canEmergencyStop, 'disconnected: canEmergencyStop = false');
  assert(!g.canUnlock, 'disconnected: canUnlock = false');
}

// 6. Status === 'connecting' → canStop false (still no controller to stop)
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'connecting' },
  }));
  assert(!g.canStop, 'connecting: canStop = false (in-flight handshake)');
}

// 7. laserOutput === 'on' → baseSafe false; canStop still true (recovery)
{
  const g = computeCommandGates(input({
    laserOutput: 'on',
  }));
  assert(!g.baseSafe, 'laser on: baseSafe = false');
  assert(!g.canTestFire, 'laser on: canTestFire = false (already firing)');
  assert(g.canStop, 'laser on: canStop = true (recovery)');
  assert(g.canEmergencyStop, 'laser on: canEmergencyStop = true');
}

// 8. laserOutput === 'unknown' → baseSafe false (T1-22 unknown blocks ops)
{
  const g = computeCommandGates(input({
    laserOutput: 'unknown',
  }));
  assert(!g.baseSafe, 'laser unknown: baseSafe = false');
  assert(!g.canFrameDot, 'laser unknown: canFrameDot = false');
}

// 9. activeOperation held → baseSafe false (T2-11 mutex)
{
  const op: ActiveOperationState = {
    kind: 'testFire',
    startedAt: 1700000000000,
    sessionId: 1,
  };
  const g = computeCommandGates(input({ activeOperation: op }));
  assert(!g.baseSafe, 'mutex held: baseSafe = false');
  assert(!g.canJog, 'mutex held: canJog = false (would just bounce off T2-11)');
  assert(!g.canFrameSafe, 'mutex held: canFrameSafe = false');
}

// 10. errorCode != null → baseSafe false (T1-24)
{
  const g = computeCommandGates(input({
    state: { ...idleState, errorCode: 42 },
  }));
  assert(!g.baseSafe, 'errorCode set: baseSafe = false');
  assert(g.canStop, 'errorCode set: canStop = true (recovery)');
}

// 11. recoveryPending === true → baseSafe false (T1-29)
{
  const g = computeCommandGates(input({ recoveryPending: true }));
  assert(!g.baseSafe, 'recoveryPending: baseSafe = false');
  assert(!g.canTestFire, 'recoveryPending: canTestFire = false');
}

// 12. canPause / canResume independent of baseSafe — they fire on
//     specific status transitions even when other gates would block.
{
  // Run state with active operation set (impossible in practice, but
  // tests the gate independence).
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'run' },
    activeOperation: {
      kind: 'frame',
      startedAt: 1,
      sessionId: 1,
    },
  }));
  assert(g.canPause, 'canPause is purely status-driven (status === run)');
  assert(!g.baseSafe, 'baseSafe still blocked by activeOperation');
}

// 13. Status === 'check' → baseSafe false; canStop true
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'check' },
  }));
  assert(!g.baseSafe, 'check mode: baseSafe = false');
  assert(g.canStop, 'check mode: canStop = true');
}

// 14. Status === 'homing' → baseSafe false
{
  const g = computeCommandGates(input({
    state: { ...idleState, status: 'homing' },
  }));
  assert(!g.baseSafe, 'homing: baseSafe = false');
  assert(g.canStop, 'homing: canStop = true');
}

// 15. ConnectionPanelMain integration: source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );

  assert(/T1-30/.test(panelSrc), 'T1-30 marker present in ConnectionPanelMain.tsx');
  assert(/import \{ computeCommandGates \}/.test(panelSrc),
    'computeCommandGates imported');
  assert(/import \{ getUnsafePriorState \}/.test(panelSrc),
    'getUnsafePriorState imported (recoveryPending source)');
  assert(/const gates = machineState\s*\?\s*computeCommandGates/.test(panelSrc),
    'gates computed once via the helper');
  // Ad-hoc gates replaced with reads from the helper.
  assert(/const canAutoFocus = gates\?\.baseSafe \?\? false/.test(panelSrc),
    'canAutoFocus reads from gates.baseSafe');
  assert(/const canFrame = gates\?\.canFrameSafe \?\? false/.test(panelSrc),
    'canFrame reads from gates.canFrameSafe');
  assert(/canFire: gates\?\.canTestFire \?\? false/.test(panelSrc),
    'canFire prop reads from gates.canTestFire');
  // PRT4040 simplification: job start no longer uses baseSafe directly
  // because baseSafe still includes stale recoveryPending bookkeeping.
  // Start uses the dedicated StartBlocker policy instead.
  assert(/evaluateStartBlockers/.test(panelSrc), 'canStartJob uses the StartBlocker policy');
  assert(/blockingStartBlocker == null/.test(panelSrc),
    'canStartJob checks that no StartBlocker is active');
  assert(!/&&\s*\(gates\?\.baseSafe \?\? false\)/.test(panelSrc),
    'canStartJob no longer hard-blocks on gates.baseSafe');
  // The OLD ad-hoc shape `isConnected && !isRunning && machineState?.status === 'idle'`
  // for canFrame / canAutoFocus / canFire is gone.
  assert(
    !/const canFrame = isConnected && !isRunning && machineState\?\.status === 'idle'/.test(panelSrc),
    'OLD ad-hoc canFrame computation removed',
  );
  assert(
    !/const canAutoFocus = isConnected && !isRunning && machineState\?\.status === 'idle'/.test(panelSrc),
    'OLD ad-hoc canAutoFocus computation removed',
  );
  assert(
    !/canFire: canFrame,/.test(panelSrc),
    'OLD canFire = canFrame alias removed (now reads gates.canTestFire)',
  );

  // Helper module source-level pin.
  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/app/computeCommandGates.ts'),
    'utf-8',
  );
  assert(/T1-30/.test(helperSrc), 'T1-30 marker in helper module');
  assert(/export interface CommandGates/.test(helperSrc),
    'CommandGates type exported');
  assert(/export function computeCommandGates/.test(helperSrc),
    'computeCommandGates function exported');
  assert(/baseSafe:\s*boolean/.test(helperSrc), 'CommandGates.baseSafe declared');
  assert(/canPause:\s*boolean/.test(helperSrc), 'CommandGates.canPause declared');
  assert(/canUnlock:\s*boolean/.test(helperSrc), 'CommandGates.canUnlock declared');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
