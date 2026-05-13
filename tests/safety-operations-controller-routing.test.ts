/**
 * T3-47: pin the generic safety-operations API as the call surface
 * for `pause` / `resume` / `stop` / `laserOff` / `testFire` /
 * `emergencyStop`.
 *
 * Three layers of routing get pinned here:
 *
 *   1. `MachineOperationApi` (T2-26 contract) declares safety
 *      operations as part of the operations object. Every controller
 *      that ships must implement them.
 *
 *   2. `GrblController.operations.{laserOff,pauseJob,resumeJob,stopJob,
 *      emergencyStop}` route to the right GRBL realtime byte / soft
 *      reset / two-stage M5 sequence (rather than emitting a stringified
 *      `sendCommand`). This is the routing-audit pin: a regression that
 *      replaced `_sendRealtime(REALTIME_FEED_HOLD)` with
 *      `sendCommand('!')` would not change emitted bytes but would
 *      bypass the realtime / blocking distinction.
 *
 *   3. App-level callers (`ExecutionCoordinator`, `MachineService`,
 *      `sendSetOriginWcsCommand`, `sendResetWcsCommand`) call
 *      `ctrl.operations.X()` rather than constructing GRBL command
 *      strings inline. This is the structural guarantee that any
 *      future controller (Marlin / Ruida / file-upload) can be slotted
 *      in by implementing `MachineOperationApi`.
 *
 * Run: npx tsx tests/safety-operations-controller-routing.test.ts
 */

import {
  canExecuteOperation,
  type OperationGateMachineState,
} from '../src/app/OperationGate';
import {
  grblCapabilities,
  type ControllerCapabilities,
} from '../src/controllers/ControllerCapabilities';

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

console.log('\n=== T3-47 generic safety-operations routing ===\n');

function idleState(overrides: Partial<OperationGateMachineState> = {}): OperationGateMachineState {
  return {
    connected: true,
    status: 'idle',
    activeOperation: null,
    homingRequiredAtBoot: false,
    ...overrides,
  };
}

async function readSrc(rel: string): Promise<string> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, '..', rel), 'utf-8');
}

void (async () => {
  // 1. MachineOperationApi declares the full safety-op contract
  //    (T2-26 + T3-47 surface). Every safety op a future controller
  //    must implement is named here, by literal source-pin.
  {
    const api = await readSrc('src/controllers/ControllerInterface.ts');

    assert(/interface MachineOperationApi\b/.test(api), 'MachineOperationApi: declared');
    for (const method of ['pauseJob', 'resumeJob', 'stopJob', 'emergencyStop', 'laserOff', 'testFire'] as const) {
      assert(
        new RegExp(`\\b${method}\\s*\\(`).test(api),
        `MachineOperationApi: ${method} declared`,
      );
    }
  }

  // 2. GrblController.operations safety methods route through realtime
  //    bytes / soft-reset / two-stage safetyOff rather than constructing
  //    GRBL command strings inline. The source pin asserts the body of
  //    the operations object delegates to existing safety methods
  //    (`safetyOff`, `pause`, `resume`, `stop`, `emergencyStop`) which
  //    are already byte-level audited by `tests/controller-stop-safety.
  //    test.ts` and `tests/grbl-byte-emission.test.ts`.
  {
    const grbl = await readSrc('src/controllers/grbl/GrblController.ts');

    // The realtime byte constants exist and are referenced from the
    // class body (not bypassed via raw command strings).
    assert(/const REALTIME_FEED_HOLD\s*=\s*0x21/.test(grbl), 'GRBL: REALTIME_FEED_HOLD = 0x21 declared');
    assert(/const REALTIME_CYCLE_START\s*=\s*0x7E/i.test(grbl), 'GRBL: REALTIME_CYCLE_START = 0x7E declared');
    assert(/const REALTIME_RESET\s*=\s*0x18/.test(grbl), 'GRBL: REALTIME_RESET = 0x18 declared');

    // operations.{pause,resume,stop,emergencyStop}Job delegate to
    // existing class methods (this.pause / this.resume / this.stop /
    // this.emergencyStop) rather than constructing strings.
    assert(
      /pauseJob\s*:\s*async\s*\(\)[\s\S]{0,160}?this\.pause\(\)/.test(grbl),
      'GRBL: operations.pauseJob delegates to this.pause()',
    );
    assert(
      /resumeJob\s*:\s*async\s*\(\)[\s\S]{0,160}?this\.resume\(\)/.test(grbl),
      'GRBL: operations.resumeJob delegates to this.resume()',
    );
    assert(
      /stopJob\s*:\s*async\s*\(\)[\s\S]{0,160}?this\.stop\(\)/.test(grbl),
      'GRBL: operations.stopJob delegates to this.stop()',
    );
    assert(
      /emergencyStop\s*:\s*async\s*\(\)[\s\S]{0,160}?this\.emergencyStop\(\)/.test(grbl),
      'GRBL: operations.emergencyStop delegates to this.emergencyStop()',
    );

    // operations.laserOff goes through safetyOff (two-stage M5 →
    // soft-reset fallback per T1-22), not a raw `sendCommand('M5 S0')`.
    assert(
      /laserOff\s*:\s*async[\s\S]{0,200}?this\.safetyOff\(\)/.test(grbl),
      'GRBL: operations.laserOff delegates to this.safetyOff() (two-stage M5)',
    );

    // The pause()/resume()/stop()/emergencyStop() class methods all
    // reach for the realtime bytes (not a string send), proving the
    // delegation chain ends in the realtime byte path.
    assert(
      /pause\s*\([^)]*\)[\s\S]{0,400}?_sendRealtime\(REALTIME_FEED_HOLD\)/.test(grbl),
      'GRBL: pause() emits REALTIME_FEED_HOLD',
    );
    assert(
      /\basync\s+resume\s*\(\s*\)\s*:\s*Promise<\s*SafetyActionResult\s*>\s*\{[\s\S]{0,5000}?_sendRealtime\(REALTIME_CYCLE_START\)/.test(grbl),
      'GRBL: resume() emits REALTIME_CYCLE_START',
    );
    assert(
      /emergencyStop\s*\([^)]*\)[\s\S]{0,800}?_sendRealtime\(REALTIME_RESET\)/.test(grbl),
      'GRBL: emergencyStop() emits REALTIME_RESET',
    );
  }

  // 3. App-level safety call sites (ExecutionCoordinator, MachineService)
  //    invoke `ctrl.operations.X()` rather than constructing inline
  //    command strings. This is the multi-controller-readiness pin: a
  //    regression that hard-coded `sendCommand('M5 S0')` in
  //    MachineService would force every future controller family to
  //    pretend to speak GRBL.
  {
    const coord = await readSrc('src/app/ExecutionCoordinator.ts');
    assert(
      /ctrl\.operations\.laserOff\(/.test(coord),
      'ExecutionCoordinator: laserOff routed through ctrl.operations.laserOff',
    );
    assert(
      /ctrl\.operations\.testFire\(/.test(coord),
      'ExecutionCoordinator: testFire routed through ctrl.operations.testFire',
    );
    assert(
      /ctrl\.operations\.frame\(/.test(coord),
      'ExecutionCoordinator: frame routed through ctrl.operations.frame',
    );

    const svc = await readSrc('src/app/MachineService.ts');
    assert(
      /ctrl\.operations\.pauseJob\(/.test(svc),
      'MachineService: pause routed through ctrl.operations.pauseJob',
    );
    assert(
      /ctrl\.operations\.resumeJob\(/.test(svc),
      'MachineService: resume routed through ctrl.operations.resumeJob',
    );
    assert(
      /ctrl\.operations\.emergencyStop\(/.test(svc),
      'MachineService: emergencyStop routed through ctrl.operations.emergencyStop',
    );
    assert(
      /ctrl\.operations\.laserOff\(/.test(svc),
      'MachineService: laserOff routed through ctrl.operations.laserOff',
    );

    // Negative pin: no app-level caller should bypass controller
    // operations or the MachineCommandGateway choke point with direct
    // controller sends. T3-90's connect-time auto-M5 is intentionally
    // routed through MachineCommandGateway and pinned by
    // auto-m5-routes-through-gateway.test.ts.
    assert(
      !/\bctrl\.sendCommand\(['"]M5\s+S0['"]/.test(svc),
      'MachineService: no direct ctrl.sendCommand("M5 S0") bypass',
    );
    assert(
      !/\bctrl\.sendCommand\(['"]M5\s+S0['"]/.test(coord),
      'ExecutionCoordinator: no direct ctrl.sendCommand("M5 S0") bypass',
    );
    assert(
      !/_sendRealtime\(/.test(svc),
      'MachineService: no inline _sendRealtime (GRBL bytes belong in controller)',
    );
    assert(
      !/_sendRealtime\(/.test(coord),
      'ExecutionCoordinator: no inline _sendRealtime (GRBL bytes belong in controller)',
    );
  }

  // 4. Capability-gated safety operations: `canExecuteOperation` refuses
  //    safety ops when the capability is false, exactly the same gate
  //    as the operator operations (T3-43 covered the general case;
  //    here we pin the safety-specific subset).
  {
    const noPause: ControllerCapabilities = {
      ...grblCapabilities,
      operations: {
        ...grblCapabilities.operations,
        canPause: false,
      },
    };
    const decision = canExecuteOperation('pause', noPause, idleState({ status: 'run' }));
    assert(!decision.allowed, 'Capability gate: canPause=false refuses pause');
    if (!decision.allowed) {
      assert(
        decision.reason === 'capability-not-supported',
        'Capability gate: pause refusal is capability-not-supported',
      );
    }

    const noEStop: ControllerCapabilities = {
      ...grblCapabilities,
      operations: {
        ...grblCapabilities.operations,
        canEmergencyStop: false,
      },
    };
    const eStopDecision = canExecuteOperation('emergency-stop', noEStop, idleState());
    assert(!eStopDecision.allowed, 'Capability gate: canEmergencyStop=false refuses emergency-stop');

    const noTestFire: ControllerCapabilities = {
      ...grblCapabilities,
      operations: {
        ...grblCapabilities.operations,
        canTestFire: false,
      },
    };
    const testFireDecision = canExecuteOperation('test-fire', noTestFire, idleState());
    assert(!testFireDecision.allowed, 'Capability gate: canTestFire=false refuses test-fire');

    const noStop: ControllerCapabilities = {
      ...grblCapabilities,
      operations: {
        ...grblCapabilities.operations,
        canSoftStop: false,
      },
    };
    const stopDecision = canExecuteOperation('stop', noStop, idleState({ status: 'run' }));
    assert(!stopDecision.allowed, 'Capability gate: canSoftStop=false refuses stop');
    if (!stopDecision.allowed) {
      assert(
        stopDecision.reason === 'capability-not-supported',
        'Capability gate: stop refusal is capability-not-supported',
      );
    }

    const noResume: ControllerCapabilities = {
      ...grblCapabilities,
      operations: {
        ...grblCapabilities.operations,
        canResume: false,
      },
    };
    const resumeDecision = canExecuteOperation('resume', noResume, idleState({ status: 'hold' }));
    assert(!resumeDecision.allowed, 'Capability gate: canResume=false refuses resume');
  }

  // 5. ControllerSafetyOps contract (T2-42) is the second-tier safety
  //    surface. Source-pin that the typed surface and the unsupported-
  //    builder both ship; T3-61 already covers behavioral refusal.
  {
    const ops = await readSrc('src/controllers/ControllerSafetyOps.ts');
    assert(/laserOff\s*\(/.test(ops), 'ControllerSafetyOps: laserOff method declared');
    assert(/pauseJob\s*\(/.test(ops), 'ControllerSafetyOps: pauseJob method declared');
    assert(/resumeJob\s*\(/.test(ops), 'ControllerSafetyOps: resumeJob method declared');
    assert(/abortJob\s*\(/.test(ops), 'ControllerSafetyOps: abortJob method declared');
    assert(/emergencyStop\s*\(/.test(ops), 'ControllerSafetyOps: emergencyStop method declared');
    assert(/beginTestFire\s*\(/.test(ops), 'ControllerSafetyOps: beginTestFire method declared');
    assert(/endTestFire\s*\(/.test(ops), 'ControllerSafetyOps: endTestFire method declared');
    assert(
      /export function makeUnsupportedSafetyOps\b/.test(ops),
      'ControllerSafetyOps: makeUnsupportedSafetyOps builder exported',
    );
  }

  // 6. ControllerSafetyCapabilities (T2-43) declares the safety-axis
  //    capability flags T3-47's safety state machine consults.
  {
    const caps = await readSrc('src/controllers/ControllerSafetyCapabilities.ts');
    for (const flag of [
      'supportsEmergencyStop',
      'emergencyStopMethod',
      'supportsRecoverablePause',
      'pauseStopsLaserOutput',
      'supportsLaserOff',
      'laserOffMethod',
      'supportsTestFire',
      'disconnectStopsJob',
    ] as const) {
      assert(
        new RegExp(`\\b${flag}\\b`).test(caps),
        `ControllerSafetyCapabilities: ${flag} declared`,
      );
    }
  }

  console.log(`\nT3-47 safety-operations routing: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
