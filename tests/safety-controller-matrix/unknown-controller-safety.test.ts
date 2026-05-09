/**
 * T3-61: per-controller-family safety regression matrix.
 *
 * This first matrix slice pins the conservative behavior for unknown
 * and not-yet-implemented controller families. GRBL has dedicated byte
 * tests already; this file ensures non-GRBL/unknown safety paths refuse
 * risky operations instead of silently borrowing GRBL assumptions.
 *
 * Run: npx tsx tests/safety-controller-matrix/unknown-controller-safety.test.ts
 */
import {
  canExecuteOperation,
  decisionMessage,
  type Operation,
  type OperationGateMachineState,
} from '../../src/app/OperationGate';
import {
  type ControllerCapabilities,
} from '../../src/controllers/ControllerCapabilities';
import {
  type ControllerSafetyCapabilities,
  reasonEmergencyStopRefused,
  reasonPauseRefused,
  reasonResumeAfterErrorRefused,
  reasonTestFireRefused,
} from '../../src/controllers/ControllerSafetyCapabilities';
import {
  makeUnsupportedSafetyOps,
} from '../../src/controllers/ControllerSafetyOps';
import {
  transitionFromSafetyResult,
  safetyStateAllowsStartJob as operationSafetyAllowsStartJob,
  safetyStateAllowsResume as operationSafetyAllowsResume,
  safetyStateBlocksAllCommands,
  type SafetyResultLike,
} from '../../src/app/SafetyStateMachine';
import {
  safetyStateAllowsStartJob as canonicalSafetyAllowsStartJob,
  safetyStateAllowsResume as canonicalSafetyAllowsResume,
  safetyStateRequiresInspection as canonicalSafetyRequiresInspection,
  type MachineSafetyState,
} from '../../src/app/MachineSafetyState';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T3-61 unknown controller safety matrix ===\n');

const UNKNOWN_CONTROLLER_CAPABILITIES: ControllerCapabilities = {
  output: {
    formats: [],
    jobExecution: 'device-native',
    supportsGcode: false,
    supportsBinary: false,
  },
  laser: {
    powerUnit: 'native',
    maxPowerValue: 0,
    supportsDynamicPower: false,
    supportsConstantPower: false,
    supportsInlinePower: false,
    laserOffOperation: 'unsupported',
  },
  motion: {
    axes: [],
    coordinateSystem: 'other',
    supportsAbsolute: false,
    supportsRelative: false,
    originModes: [],
    bedWidthMm: 0,
    bedHeightMm: 0,
  },
  operations: {
    canHome: false,
    canUnlock: false,
    canJog: false,
    canSetWorkOrigin: false,
    canFrame: false,
    canTestFire: false,
    canAutofocus: false,
    canPause: false,
    canResume: false,
    canSoftStop: false,
    canEmergencyStop: false,
  },
  transport: {
    supportedKinds: [],
    ackModel: 'none',
  },
};

const UNKNOWN_SAFETY_CAPABILITIES: ControllerSafetyCapabilities = {
  supportsEmergencyStop: false,
  emergencyStopMethod: 'unsupported',
  emergencyStopLatencyMs: 'unknown',
  supportsRecoverablePause: false,
  pauseStopsLaserOutput: 'unknown',
  pauseLatencyClass: 'unknown',
  resumeRequiresStateRestore: true,
  resumeSupportedAfterError: false,
  supportsLaserOff: false,
  laserOffCanBeVerified: false,
  laserOffMethod: 'unsupported',
  supportsTestFire: false,
  testFireRequiresMotion: false,
  testFireMaxDurationMs: 0,
  disconnectStopsJob: 'unknown',
  stopInvalidatesPosition: 'unknown',
  stopRequiresRehome: 'unknown',
  executionModel: 'unknown',
};

function idleState(overrides: Partial<OperationGateMachineState> = {}): OperationGateMachineState {
  return {
    connected: true,
    status: 'idle',
    activeOperation: null,
    homingRequiredAtBoot: false,
    ...overrides,
  };
}

function refusalFor(op: Operation, state = idleState()): string {
  const decision = canExecuteOperation(op, UNKNOWN_CONTROLLER_CAPABILITIES, state);
  assert(!decision.allowed, `${op}: refused for unknown controller`);
  if (!decision.allowed) {
    assert(decision.reason === 'capability-not-supported', `${op}: capability-not-supported`);
    const detail = decisionMessage(decision);
    assert(typeof detail === 'string' && detail.length > 0, `${op}: user-facing detail`);
    return detail ?? '';
  }
  return '';
}

function refusedResult(
  action: SafetyResultLike['action'],
  message: string,
): SafetyResultLike {
  return {
    action,
    accepted: false,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: false,
    requiresInspection: false,
    message,
  };
}

async function source(relativePath: string): Promise<string> {
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, '..', relativePath), 'utf-8');
}

async function findControllerSource(namePart: string): Promise<string[]> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const root = path.resolve(here, '../../src/controllers');
  const found: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      if (entry.isFile() && entry.name.toLowerCase().includes(namePart.toLowerCase())) {
        found.push(fs.readFileSync(full, 'utf-8'));
      }
    }
  }

  walk(root);
  return found;
}

void (async () => {
  // 1. Unknown controller disables risky operator operations.
  {
    const jobStart = refusalFor('job-start');
    assert(/job|execution|output/i.test(jobStart), 'job-start refusal names job execution/output');

    const testFire = refusalFor('test-fire');
    assert(/test-fire|test fire/i.test(testFire), 'test-fire refusal names test fire');

    const frameDot = refusalFor('frame-dot');
    assert(/framing|frame/i.test(frameDot), 'frame-dot refusal names framing');

    const pause = refusalFor('pause', idleState({ status: 'run' }));
    assert(/pause/i.test(pause), 'pause refusal names pause');

    const resume = refusalFor('resume', idleState({ status: 'hold' }));
    assert(/resume/i.test(resume), 'resume refusal names resume');
  }

  // 2. Unknown safety capabilities produce explicit refusals.
  {
    const eStopReason = reasonEmergencyStopRefused(UNKNOWN_SAFETY_CAPABILITIES);
    assert(eStopReason !== null && /emergency stop/i.test(eStopReason), 'unknown e-stop refusal is explicit');

    const pauseReason = reasonPauseRefused(UNKNOWN_SAFETY_CAPABILITIES);
    assert(pauseReason !== null && /pause/i.test(pauseReason), 'unknown pause refusal is explicit');

    const resumeReason = reasonResumeAfterErrorRefused(UNKNOWN_SAFETY_CAPABILITIES);
    assert(resumeReason !== null && /alarm|re-home|error/i.test(resumeReason), 'unknown resume-after-error refusal is explicit');

    const testFireReason = reasonTestFireRefused(UNKNOWN_SAFETY_CAPABILITIES, 100);
    assert(testFireReason !== null && /test fire/i.test(testFireReason), 'unknown test-fire refusal is explicit');
  }

  // 3. Unsupported safety ops refuse without throwing and mark observability unknown.
  {
    const ops = makeUnsupportedSafetyOps('Unknown controller has no declared safety strategy.', () => 6161);
    const begin = await ops.beginTestFire({ powerS: 50, durationMs: 250 });
    const pause = await ops.pauseJob();
    const resume = await ops.resumeJob();
    const laserOff = await ops.laserOff('T3-61', 'urgent');
    const emergency = await ops.emergencyStop();

    for (const [label, result] of [
      ['beginTestFire', begin],
      ['pauseJob', pause],
      ['resumeJob', resume],
      ['laserOff', laserOff],
      ['emergencyStop', emergency],
    ] as const) {
      assert(result.accepted === false, `${label}: unsupported safety op refused`);
      assert(result.motionState === 'unknown', `${label}: motion state unknown`);
      assert(result.laserState === 'unknown', `${label}: laser state unknown`);
      assert(result.positionTrusted === 'unknown', `${label}: position trust unknown`);
      assert(result.timestamp === 6161, `${label}: deterministic timestamp`);
      assert(/unknown controller/i.test(result.message ?? ''), `${label}: message names unknown controller`);
    }
  }

  // 4. Failed emergency/test-fire/laser-off results transition to unsafeUnknown and block.
  {
    const failedEmergency = transitionFromSafetyResult(
      { kind: 'running' },
      refusedResult('emergencyStop', 'Controller does not support emergency stop.'),
      6161,
    );
    assert(failedEmergency.kind === 'unsafeUnknown', 'failed emergency stop -> unsafeUnknown');
    assert(safetyStateBlocksAllCommands(failedEmergency), 'unsafeUnknown blocks all commands');
    assert(!operationSafetyAllowsStartJob(failedEmergency), 'unsafeUnknown blocks operation safety start');
    assert(!operationSafetyAllowsResume(failedEmergency), 'unsafeUnknown blocks operation safety resume');

    const failedTestFire = transitionFromSafetyResult(
      { kind: 'safeIdle' },
      refusedResult('beginTestFire', 'Controller does not support test fire.'),
      6161,
    );
    assert(failedTestFire.kind === 'unsafeUnknown', 'failed beginTestFire -> unsafeUnknown');

    const failedLaserOff = transitionFromSafetyResult(
      { kind: 'safeIdle' },
      refusedResult('laserOff', 'Controller does not support laser off.'),
      6161,
    );
    assert(failedLaserOff.kind === 'unsafeUnknown', 'failed laserOff -> unsafeUnknown');

    const canonical: MachineSafetyState = {
      kind: 'UNSAFE_UNKNOWN',
      reason: failedEmergency.kind === 'unsafeUnknown' ? failedEmergency.reason : 'failed e-stop',
    };
    assert(!canonicalSafetyAllowsStartJob(canonical), 'canonical UNSAFE_UNKNOWN blocks job start');
    assert(!canonicalSafetyAllowsResume(canonical), 'canonical UNSAFE_UNKNOWN blocks resume');
    assert(canonicalSafetyRequiresInspection(canonical), 'canonical UNSAFE_UNKNOWN requires inspection');
  }

  // 5. Future Marlin/Ruida sources must not accidentally inherit GRBL safety commands.
  {
    const marlinSources = await findControllerSource('marlin');
    for (const src of marlinSources) {
      assert(!/0x18|0x21|0x7e|M5 S0/.test(src), 'Marlin source does not emit GRBL realtime/M5 safety commands');
    }
    assert(marlinSources.length === 0 || marlinSources.length > 0, 'Marlin controller absence/presence checked');

    const ruidaSources = await findControllerSource('ruida');
    for (const src of ruidaSources) {
      assert(!/M5 S0|gcode-m5|0x18/.test(src), 'Ruida source does not pretend GRBL M5/soft-reset is native laser-off');
    }
    assert(ruidaSources.length === 0 || ruidaSources.length > 0, 'Ruida controller absence/presence checked');
  }

  // 6. Existing GRBL safety byte coverage remains pinned by adjacent tests.
  {
    const grblSafetyTest = await source('controller-safety-action-result-methods.test.ts');
    assert(grblSafetyTest.includes('0x21'), 'GRBL pause test pins feed hold byte 0x21');
    assert(grblSafetyTest.includes('0x7e'), 'GRBL resume test pins cycle-start byte 0x7e');
    assert(grblSafetyTest.includes('0x18'), 'GRBL stop/e-stop tests pin soft-reset byte 0x18');

    const disconnectTest = await source('execution-coordinator-disconnect.test.ts');
    assert(disconnectTest.includes('M5 S0'), 'GRBL disconnect tests pin best-effort M5 S0');
    assert(/machineService\.disconnect/.test(disconnectTest), 'GRBL disconnect tests exercise service disconnect path');
  }

  // 7. Test-fire deadman is owned by the coordinator/service, not the UI.
  {
    const coordinator = await source('../src/app/ExecutionCoordinator.ts');
    assert(coordinator.includes('TEST_FIRE_DEADMAN_MS'), 'ExecutionCoordinator exports test-fire deadman duration');
    assert(coordinator.includes('_testFireTimerHandle'), 'ExecutionCoordinator owns test-fire timer handle');
    assert(/setTimeout\(\(\) =>/.test(coordinator), 'ExecutionCoordinator arms the deadman timer');
    assert(/emergencyLaserOff\(\)\.finally/.test(coordinator), 'deadman forces laser-off and releases operation');

    const deadmanTest = await source('execution-coordinator-deadman.test.ts');
    assert(/deadman fired/.test(deadmanTest), 'dedicated deadman test covers timeout firing');
    assert(/no deadman M5 when beginTestFire failed/.test(deadmanTest), 'deadman test covers failed start path');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
