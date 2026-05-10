/**
 * T3-43: controller simulator / test matrix - first slice.
 *
 * This file is the family-agnostic regression matrix on top of the
 * pure capability/operation-gate authority (T2-25 ControllerCapabilities,
 * T2-40 OperationGate, T2-26 semantic operations on the controller
 * surface). It pins behavior for four representative controller-family
 * shapes plus an explicit "no executable output" shape for T2-29's
 * job-start gate:
 *
 *   - GRBL (line-stream gcode-text, full operations)
 *   - Marlin-shape (line-stream gcode-text, no test-fire / autofocus)
 *   - Binary-stream Ruida-shape (native-binary, no jog / home / frame)
 *   - File-upload gcode (gcode-text + supportsGcode but no jog/test-fire)
 *   - No-output (formats=[], supportsGcode=false, supportsBinary=false)
 *
 * The slice keeps production behavior unchanged and reuses the existing
 * `ControllerCapabilities` shape, `applyProfileOverrides` (T2-25), and
 * `canExecuteOperation` (T2-40). Profile/controller-family mismatch
 * (T2-30 Falcon WiFi as transport) and live FakeMarlin/FakeBinary
 * controller stubs are intentionally out of scope here; the capability
 * fixtures cover the same contract surface without duplicating
 * controller plumbing.
 *
 * Pairs with T3-61 `tests/safety-controller-matrix/`, which pins the
 * conservative refusal of *unknown* controllers; this file pins the
 * positive-shape refusals/allows for *advertised* capability subsets.
 *
 * Run: npx tsx tests/controller-matrix/operation-routing-by-family.test.ts
 */

import {
  canExecuteOperation,
  decisionMessage,
  isOperationAllowed,
  type Operation,
  type OperationGateMachineState,
} from '../../src/app/OperationGate';
import {
  applyProfileOverrides,
  grblCapabilities,
  type ControllerCapabilities,
} from '../../src/controllers/ControllerCapabilities';

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

console.log('\n=== T3-43 controller matrix: operation routing by family ===\n');

function idleState(overrides: Partial<OperationGateMachineState> = {}): OperationGateMachineState {
  return {
    connected: true,
    status: 'idle',
    activeOperation: null,
    homingRequiredAtBoot: false,
    ...overrides,
  };
}

const MARLIN_SHAPE_CAPS: ControllerCapabilities = {
  output: {
    formats: ['gcode-text'],
    jobExecution: 'line-stream',
    supportsGcode: true,
    supportsBinary: false,
    maxLineLength: 96,
  },
  laser: {
    powerUnit: 'pwm-byte',
    maxPowerValue: 255,
    supportsDynamicPower: false,
    supportsConstantPower: true,
    supportsInlinePower: false,
    laserOffOperation: 'gcode-m5',
  },
  motion: {
    axes: ['x', 'y'],
    coordinateSystem: 'cartesian',
    supportsAbsolute: true,
    supportsRelative: true,
    originModes: ['absolute', 'current'],
    bedWidthMm: 300,
    bedHeightMm: 300,
  },
  operations: {
    canHome: true,
    canUnlock: false,
    canJog: true,
    canSetWorkOrigin: true,
    canFrame: true,
    canTestFire: false,
    canAutofocus: false,
    canPause: true,
    canResume: true,
    canSoftStop: true,
    canEmergencyStop: true,
  },
  transport: {
    supportedKinds: ['usb-serial'],
    ackModel: 'ok-line',
  },
};

const RUIDA_SHAPE_CAPS: ControllerCapabilities = {
  output: {
    formats: ['native-binary'],
    jobExecution: 'binary-stream',
    supportsGcode: false,
    supportsBinary: true,
    maxJobBytes: 100_000_000,
  },
  laser: {
    powerUnit: 'native',
    maxPowerValue: 100,
    supportsDynamicPower: false,
    supportsConstantPower: false,
    supportsInlinePower: true,
    laserOffOperation: 'native-stop',
  },
  motion: {
    axes: ['x', 'y'],
    coordinateSystem: 'cartesian',
    supportsAbsolute: true,
    supportsRelative: false,
    originModes: ['absolute'],
    bedWidthMm: 900,
    bedHeightMm: 600,
  },
  operations: {
    canHome: false,
    canUnlock: false,
    canJog: false,
    canSetWorkOrigin: false,
    canFrame: false,
    canTestFire: false,
    canAutofocus: false,
    canPause: true,
    canResume: true,
    canSoftStop: true,
    canEmergencyStop: true,
  },
  transport: {
    supportedKinds: ['usb-bulk'],
    ackModel: 'device-progress',
  },
};

const FILE_UPLOAD_CAPS: ControllerCapabilities = {
  output: {
    formats: ['gcode-text'],
    jobExecution: 'file-upload',
    supportsGcode: true,
    supportsBinary: false,
    maxJobBytes: 50_000_000,
  },
  laser: {
    powerUnit: 'spindle-s',
    maxPowerValue: 1000,
    supportsDynamicPower: true,
    supportsConstantPower: true,
    supportsInlinePower: false,
    laserOffOperation: 'gcode-m5',
  },
  motion: {
    axes: ['x', 'y'],
    coordinateSystem: 'cartesian',
    supportsAbsolute: true,
    supportsRelative: true,
    originModes: ['absolute', 'savedOrigin'],
    bedWidthMm: 400,
    bedHeightMm: 400,
  },
  operations: {
    canHome: true,
    canUnlock: false,
    canJog: false,
    canSetWorkOrigin: false,
    canFrame: false,
    canTestFire: false,
    canAutofocus: false,
    canPause: true,
    canResume: true,
    canSoftStop: true,
    canEmergencyStop: true,
  },
  transport: {
    supportedKinds: ['wifi'],
    ackModel: 'device-progress',
  },
};

const NO_OUTPUT_CAPS: ControllerCapabilities = {
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

function decideRefuseReason(
  op: Operation,
  caps: ControllerCapabilities,
  state: OperationGateMachineState = idleState(),
): { allowed: false; reason: string; detail: string } | null {
  const decision = canExecuteOperation(op, caps, state);
  if (decision.allowed) return null;
  return decision;
}

void (async () => {
  // 1. GRBL fixture: stock capabilities allow the standard operator
  //    operations when idle, and refuse autofocus by default (per the
  //    grblCapabilities declaration; profiles override this for hardware
  //    that ships an autofocus probe).
  {
    const idle = idleState();

    for (const op of [
      'home', 'unlock', 'jog', 'set-origin',
      'frame-safe', 'frame-dot', 'test-fire',
      'job-start', 'emergency-stop', 'stop',
    ] as const) {
      const stateForOp =
        op === 'unlock' ? idleState({ status: 'alarm' }) :
        idle;
      assert(
        isOperationAllowed(op, grblCapabilities, stateForOp),
        `GRBL: ${op} allowed when idle/connected`,
      );
    }

    const autofocus = decideRefuseReason('autofocus', grblCapabilities);
    assert(autofocus !== null, 'GRBL: autofocus refused when capability is false (default)');
    assert(
      autofocus?.reason === 'capability-not-supported',
      'GRBL: autofocus refusal reason is capability-not-supported',
    );
    assert(
      typeof autofocus?.detail === 'string' && /autofocus/i.test(autofocus.detail),
      'GRBL: autofocus refusal detail names autofocus',
    );

    // pause requires run-state, not idle; this is a machine-state gate,
    // not a capability gate.
    const pauseFromIdle = decideRefuseReason('pause', grblCapabilities, idle);
    assert(pauseFromIdle !== null, 'GRBL: pause refused from idle');
    assert(
      pauseFromIdle?.reason === 'machine-state-prevents',
      'GRBL: pause refusal from idle is machine-state-prevents (not capability)',
    );
    assert(
      isOperationAllowed('pause', grblCapabilities, idleState({ status: 'run' })),
      'GRBL: pause allowed from run',
    );
  }

  // 2. Marlin-shape fixture: gcode-text line-stream, no test-fire,
  //    no autofocus, no unlock. Job-start succeeds because gcode-text
  //    is in the output formats list.
  {
    const idle = idleState();

    assert(isOperationAllowed('home', MARLIN_SHAPE_CAPS, idle), 'Marlin-shape: home allowed');
    assert(isOperationAllowed('jog', MARLIN_SHAPE_CAPS, idle), 'Marlin-shape: jog allowed');
    assert(isOperationAllowed('frame-safe', MARLIN_SHAPE_CAPS, idle), 'Marlin-shape: frame-safe allowed');
    assert(isOperationAllowed('job-start', MARLIN_SHAPE_CAPS, idle), 'Marlin-shape: job-start allowed (gcode-text)');

    const testFire = decideRefuseReason('test-fire', MARLIN_SHAPE_CAPS);
    assert(testFire?.reason === 'capability-not-supported', 'Marlin-shape: test-fire refused capability-not-supported');
    assert(
      typeof testFire?.detail === 'string' && /test[- ]fire/i.test(testFire.detail),
      'Marlin-shape: test-fire refusal names test-fire',
    );

    const autofocus = decideRefuseReason('autofocus', MARLIN_SHAPE_CAPS);
    assert(autofocus?.reason === 'capability-not-supported', 'Marlin-shape: autofocus refused capability-not-supported');

    const unlock = decideRefuseReason('unlock', MARLIN_SHAPE_CAPS, idleState({ status: 'alarm' }));
    assert(unlock?.reason === 'capability-not-supported', 'Marlin-shape: unlock refused capability-not-supported (no $X analog)');
  }

  // 3. Ruida-shape fixture: native-binary stream, no jog/home/frame/
  //    test-fire/autofocus/unlock — galvo-style binary controllers do
  //    not expose interactive motion. job-start still succeeds because
  //    native-binary is in the output formats list (T2-29 enforcement
  //    treats native-binary as an executable format alongside gcode).
  {
    const idle = idleState();

    assert(
      isOperationAllowed('job-start', RUIDA_SHAPE_CAPS, idle),
      'Ruida-shape: job-start allowed (native-binary in formats)',
    );

    for (const op of ['jog', 'home', 'frame-safe', 'frame-dot', 'test-fire', 'autofocus'] as const) {
      const refuse = decideRefuseReason(op, RUIDA_SHAPE_CAPS);
      assert(refuse !== null, `Ruida-shape: ${op} refused`);
      assert(
        refuse?.reason === 'capability-not-supported',
        `Ruida-shape: ${op} refusal reason is capability-not-supported`,
      );
    }

    // Pause / emergency-stop are explicitly supported on Ruida-shape.
    assert(
      isOperationAllowed('pause', RUIDA_SHAPE_CAPS, idleState({ status: 'run' })),
      'Ruida-shape: pause allowed from run',
    );
    assert(
      isOperationAllowed('emergency-stop', RUIDA_SHAPE_CAPS, idle),
      'Ruida-shape: emergency-stop allowed',
    );
  }

  // 4. File-upload fixture: gcode-text but file-upload execution model
  //    (one-shot HTTP/WS upload). job-start allowed because gcode-text
  //    is advertised. Jog refused because the controller has no
  //    interactive motion command path.
  {
    const idle = idleState();

    assert(
      isOperationAllowed('job-start', FILE_UPLOAD_CAPS, idle),
      'File-upload: job-start allowed (gcode-text advertised)',
    );
    assert(isOperationAllowed('home', FILE_UPLOAD_CAPS, idle), 'File-upload: home allowed');

    const jog = decideRefuseReason('jog', FILE_UPLOAD_CAPS);
    assert(jog?.reason === 'capability-not-supported', 'File-upload: jog refused capability-not-supported');

    const frame = decideRefuseReason('frame-safe', FILE_UPLOAD_CAPS);
    assert(frame?.reason === 'capability-not-supported', 'File-upload: frame-safe refused capability-not-supported');
  }

  // 5. T2-29 enforcement — no executable output format means job-start
  //    refuses with capability-not-supported. This is the structural
  //    guarantee against a future controller plumbing path that
  //    accidentally exposes "Start Job" while advertising no executable
  //    output.
  {
    const idle = idleState();
    const decision = canExecuteOperation('job-start', NO_OUTPUT_CAPS, idle);
    assert(!decision.allowed, 'No-output: job-start refused');
    if (!decision.allowed) {
      assert(
        decision.reason === 'capability-not-supported',
        'No-output: job-start refusal is capability-not-supported',
      );
      const message = decisionMessage(decision);
      assert(
        typeof message === 'string' && /executable|output|format/i.test(message),
        'No-output: job-start refusal names executable output / format',
      );
    }
  }

  // 6. Profile-override propagation (T2-25): runtime profile flips
  //    canExecuteOperation results without mutating the controller's
  //    static capabilities. The most user-visible case is a profile
  //    that disables homing (e.g. a small diode laser without limit
  //    switches) — homingEnabled=false must collapse home to a
  //    capability-not-supported refusal at the gate.
  {
    const idle = idleState();
    const homingDisabled = applyProfileOverrides(grblCapabilities, { homingEnabled: false });
    const decision = decideRefuseReason('home', homingDisabled);
    assert(decision !== null, 'Profile override: homingEnabled=false refuses home');
    assert(
      decision?.reason === 'capability-not-supported',
      'Profile override: home refusal is capability-not-supported',
    );

    // The original grblCapabilities object is not mutated.
    assert(
      grblCapabilities.operations.canHome === true,
      'Profile override: input capabilities not mutated',
    );

    // Inverse direction — autofocusSupported=true unlocks autofocus on
    // a controller whose default is false.
    const autofocusEnabled = applyProfileOverrides(grblCapabilities, { autofocusSupported: true });
    assert(
      isOperationAllowed('autofocus', autofocusEnabled, idle),
      'Profile override: autofocusSupported=true unlocks autofocus',
    );
  }

  // 7. Source pins (T2-26 enforcement): GRBL controller exposes
  //    semantic operation methods, not stringified sendCommand calls.
  //    These pins guard against a future regression where the central
  //    operations object is renamed or removed and call sites fall back
  //    to raw command construction.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const grblSource = fs.readFileSync(
      path.resolve(here, '../../src/controllers/grbl/GrblController.ts'),
      'utf-8',
    );

    assert(
      /readonly\s+family\s*=\s*'grbl'\s+as\s+const/.test(grblSource),
      'GrblController: family declared as grbl literal',
    );
    assert(
      /readonly\s+operations\s*=\s*\{/.test(grblSource),
      'GrblController: exposes readonly operations object (T2-26 semantic surface)',
    );
    for (const method of ['jog', 'home', 'unlockAlarm', 'frame', 'testFire', 'laserOff'] as const) {
      assert(
        new RegExp(`\\b${method}\\s*:\\s*async`).test(grblSource),
        `GrblController.operations.${method}: declared as semantic async method`,
      );
    }
  }

  // 8. GRBL regression: the canonical grblCapabilities still advertises
  //    the contract this app currently ships (gcode-text, line-stream,
  //    M3+M4, all operator operations, ok-line ack).
  {
    assert(grblCapabilities.output.formats.includes('gcode-text'), 'GRBL caps: gcode-text in output formats');
    assert(grblCapabilities.output.jobExecution === 'line-stream', 'GRBL caps: jobExecution is line-stream');
    assert(grblCapabilities.output.supportsGcode === true, 'GRBL caps: supportsGcode true');
    assert(grblCapabilities.laser.supportsDynamicPower === true, 'GRBL caps: supportsDynamicPower true (M4)');
    assert(grblCapabilities.laser.supportsConstantPower === true, 'GRBL caps: supportsConstantPower true (M3)');
    assert(grblCapabilities.laser.laserOffOperation === 'gcode-m5', 'GRBL caps: laserOffOperation gcode-m5');
    assert(grblCapabilities.transport.ackModel === 'ok-line', 'GRBL caps: ackModel ok-line');

    for (const op of ['canHome', 'canUnlock', 'canJog', 'canFrame', 'canTestFire', 'canPause', 'canResume', 'canSoftStop', 'canEmergencyStop'] as const) {
      assert(
        grblCapabilities.operations[op] === true,
        `GRBL caps: operations.${op} true`,
      );
    }
    // canAutofocus stays false by default — controller-default; profiles override.
    assert(
      grblCapabilities.operations.canAutofocus === false,
      'GRBL caps: operations.canAutofocus false by default (profile-overridable)',
    );
  }

  console.log(`\nT3-43 controller matrix: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
