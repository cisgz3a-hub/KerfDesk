/**
 * T1-206 (Phase 2): regression test for the real
 * disconnected / connecting / recovery mode bodies + the
 * `recoveryVariantFromState` pure helper.
 *
 * The mode components are React-heavy (ConnectWizard imports
 * browser-compat detection; RecoveryCard renders structured
 * content). Full React rendering is out of scope for this
 * test-runner; instead this test pins:
 *
 *   - `recoveryVariantFromState` produces the correct variant +
 *     payload fields for every RecoveryState shape.
 *   - The mode component files exist at their expected paths,
 *     declare T1-206 markers, and import the existing components
 *     they're meant to reuse.
 *   - The `WorkflowPanel.tsx` mode-content router calls each of
 *     the three Phase-2 mode components.
 *   - The `ConnectionPanel.tsx` adapter wires the new props
 *     (webSerialSupported, alarmCode, onRecoveryAction) and the
 *     real Connect-USB handler.
 *
 * Run: npx tsx tests/workflow-panel-phase2-modes.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryVariantFromState } from '../src/ui/components/workflow/recoveryVariantFromState';
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

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-206 WorkflowPanel Phase 2 modes ===\n');

// -------- 1. recoveryVariantFromState: alarm state --------
{
  const state: RecoveryState = {
    status: 'alarm',
    alarmCode: 7,
    occurredAt: 0,
    requiresRehome: true,
    inspectionDone: false,
    unlockDone: false,
    rehomeDone: false,
    reframeDone: false,
  };
  const r = recoveryVariantFromState({ recoveryState: state, machineStatus: 'alarm', alarmCode: 7 });
  assert(r.variant === 'alarm', `alarm state → 'alarm' variant (got '${r.variant}')`);
  assert(r.alarmCode === 7, `alarm state propagates alarmCode (got ${r.alarmCode})`);
  assert(r.frameTimeoutSec === null, 'alarm state has null frameTimeoutSec');
  assert(r.errorMessage === null, 'alarm state has null errorMessage');
}

// -------- 2. recoveryVariantFromState: disconnectDuringJob → 'disconnect' --------
{
  const state: RecoveryState = {
    status: 'disconnectDuringJob',
    occurredAt: 0,
    lastJobLine: 100,
    requiresRehome: true,
    reconnectDone: false,
    rehomeDone: false,
    reframeDone: false,
  };
  const r = recoveryVariantFromState({ recoveryState: state, machineStatus: null, alarmCode: null });
  assert(r.variant === 'disconnect', "disconnectDuringJob → 'disconnect' variant");
}

// -------- 3. recoveryVariantFromState: emergencyStopped → 'emergency-stop' --------
{
  const state: RecoveryState = {
    status: 'emergencyStopped',
    occurredAt: 0,
    reconnectDone: false,
    rehomeDone: false,
    reframeDone: false,
  };
  const r = recoveryVariantFromState({ recoveryState: state, machineStatus: null, alarmCode: null });
  assert(r.variant === 'emergency-stop', "emergencyStopped → 'emergency-stop' variant");
}

// -------- 4. recoveryVariantFromState: frameFailed → 'frame-failed' --------
{
  const state: RecoveryState = {
    status: 'frameFailed',
    reason: 'idle-timeout',
    occurredAt: 0,
    reframeDone: false,
  };
  const r = recoveryVariantFromState({ recoveryState: state, machineStatus: null, alarmCode: null });
  assert(r.variant === 'frame-failed', "frameFailed → 'frame-failed' variant");
  assert(r.frameTimeoutSec === 15, 'frame-failed surfaces default 15s timeout');
}

// -------- 5. recoveryVariantFromState: compileFailed → 'job-failed' --------
{
  const state: RecoveryState = {
    status: 'compileFailed',
    errorMessage: 'parse error at line 42',
    occurredAt: 0,
    recompileDone: false,
  };
  const r = recoveryVariantFromState({ recoveryState: state, machineStatus: null, alarmCode: null });
  assert(r.variant === 'job-failed', "compileFailed → 'job-failed' variant");
  assert(r.errorMessage === 'parse error at line 42', 'compileFailed propagates errorMessage');
}

// -------- 6. recoveryVariantFromState: none + alarm status → 'alarm' --------
//
// The fallback path: RecoveryState is still 'none' (transient state
// right after the alarm fires before the service raises recovery)
// but the machine status reports alarm. Caller's derivePanelMode
// routed into recovery mode; we synthesize the right card.
{
  const state: RecoveryState = { status: 'none' };
  const r = recoveryVariantFromState({ recoveryState: state, machineStatus: 'alarm', alarmCode: 5 });
  assert(r.variant === 'alarm', "none + machineStatus='alarm' → 'alarm' variant");
  assert(r.alarmCode === 5, 'fallback alarm card uses machineState.alarmCode');
}

// -------- 7. recoveryVariantFromState: none + faulted status → 'alarm' --------
{
  const state: RecoveryState = { status: 'none' };
  const r = recoveryVariantFromState({
    recoveryState: state,
    machineStatus: 'faulted_requires_inspection',
    alarmCode: null,
  });
  assert(r.variant === 'alarm', "none + machineStatus='faulted_requires_inspection' → 'alarm' variant");
}

// -------- 8. Mode component files exist + carry T1-206 markers --------
{
  const disconnectedSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/DisconnectedMode.tsx'),
    'utf-8',
  );
  assert(/T1-206/.test(disconnectedSrc), 'DisconnectedMode.tsx carries T1-206 marker');
  assert(
    /import \{ ConnectWizard \} from '\.\.\/\.\.\/connection\/ConnectWizard'/.test(disconnectedSrc),
    'DisconnectedMode imports ConnectWizard (reuses existing component)',
  );
  assert(
    /React\.createElement\(ConnectWizard/.test(disconnectedSrc),
    'DisconnectedMode renders ConnectWizard in its body',
  );

  const connectingSrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/ConnectingMode.tsx'),
    'utf-8',
  );
  assert(/T1-206/.test(connectingSrc), 'ConnectingMode.tsx carries T1-206 marker');
  assert(/spin/i.test(connectingSrc), 'ConnectingMode includes a spinner');
  assert(/Cancel/.test(connectingSrc), 'ConnectingMode hints at the Cancel button in the footer');

  const recoverySrc = readFileSync(
    resolve(here, '../src/ui/components/workflow/modes/RecoveryMode.tsx'),
    'utf-8',
  );
  assert(/T1-206/.test(recoverySrc), 'RecoveryMode.tsx carries T1-206 marker');
  assert(
    /import \{ RecoveryCard \} from '\.\.\/\.\.\/\.\.\/recovery\/RecoveryCard'/.test(recoverySrc),
    'RecoveryMode imports RecoveryCard (reuses existing component)',
  );
  assert(
    /recoveryVariantFromState/.test(recoverySrc),
    'RecoveryMode uses the pure variant-derivation helper',
  );
  assert(
    /buildRecoveryCard/.test(recoverySrc),
    'RecoveryMode uses the existing card content builder',
  );
}

// -------- 9. WorkflowPanel routes to real modes for Phase 2 --------
{
  const src = readFileSync(resolve(here, '../src/ui/components/workflow/WorkflowPanel.tsx'), 'utf-8');
  assert(/T1-206/.test(src), 'WorkflowPanel.tsx carries T1-206 marker');
  assert(/renderModeContent/.test(src), 'WorkflowPanel.tsx extracts renderModeContent helper');
  assert(/import \{ DisconnectedMode \}/.test(src), 'imports DisconnectedMode');
  assert(/import \{ ConnectingMode \}/.test(src), 'imports ConnectingMode');
  assert(/import \{ RecoveryMode \}/.test(src), 'imports RecoveryMode');
  assert(
    /React\.createElement\(DisconnectedMode/.test(src),
    'router renders DisconnectedMode for the disconnected mode',
  );
  assert(
    /React\.createElement\(ConnectingMode\)/.test(src),
    'router renders ConnectingMode for the connecting mode',
  );
  assert(
    /React\.createElement\(RecoveryMode/.test(src),
    'router renders RecoveryMode for the recovery mode',
  );
  // setup / ready / running / paused still use ModeStub in Phase 2.
  assert(
    /case 'setup':[\s\S]{0,300}ModeStub/.test(src),
    'setup mode still uses ModeStub (Phase 3 will replace)',
  );
  assert(
    /case 'ready':[\s\S]{0,300}ModeStub/.test(src),
    'ready mode still uses ModeStub (Phase 4 will replace)',
  );
}

// -------- 10. ConnectionPanel adapter wires the new props --------
{
  const src = readFileSync(resolve(here, '../src/ui/components/ConnectionPanel.tsx'), 'utf-8');
  assert(/T1-206/.test(src), 'ConnectionPanel.tsx carries T1-206 marker');
  assert(/WebSerialPort\.isSupported\(\)/.test(src), 'adapter wires webSerialSupported via WebSerialPort.isSupported');
  assert(
    /machineService\.connectRealLaser\(115200\)/.test(src),
    'adapter wires onConnectUsb to machineService.connectRealLaser',
  );
  assert(
    /machineService\.cancelActiveConnect\(\)/.test(src),
    'adapter wires onCancelConnect to machineService.cancelActiveConnect',
  );
  // Recovery action dispatch — pin the critical paths.
  assert(
    /case 'unlock'[\s\S]{0,200}executionCoordinator\.unlock\(\)/.test(src),
    "adapter wires 'unlock' to executionCoordinator.unlock",
  );
  assert(
    /case 'reconnect'[\s\S]{0,300}machineService\.disconnect\(\)/.test(src),
    "adapter wires 'reconnect' to machineService.disconnect",
  );
  assert(
    /case 'stop'[\s\S]{0,300}stopAndEnsureLaserOff/.test(src),
    "adapter wires 'stop' to machineService.stopAndEnsureLaserOff",
  );
  // isConnecting tracking
  assert(
    /setIsConnecting\(true\)/.test(src),
    'adapter sets isConnecting=true on Connect',
  );
  assert(
    /if \(isConnected\) setIsConnecting\(false\)/.test(src),
    'adapter clears isConnecting when isConnected becomes true',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
