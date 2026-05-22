/**
 * LF-EXT-BCNC-004: controller-family/profile boundaries.
 *
 * bCNC keeps GRBL-family command behavior in explicit controller modules.
 * LaserForge should preserve that lesson by refusing GRBL-console and
 * work-coordinate operations when the active profile/controller does not
 * advertise the matching capability.
 *
 * Run: npx tsx tests/controller-family-profile-boundaries.test.ts
 */
import {
  canExecuteOperation,
  decisionMessage,
  type OperationGateMachineState,
} from '../src/app/OperationGate';
import {
  grblCapabilities,
  type ControllerCapabilities,
} from '../src/controllers/ControllerCapabilities';
import { getGrblFirmwareAdapter } from '../src/controllers/GrblFirmwareAdapter';
import { getMarlinFirmwareAdapter, MarlinNotYetSupportedError } from '../src/controllers/MarlinFirmwareAdapter';
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function idleState(overrides: Partial<OperationGateMachineState> = {}): OperationGateMachineState {
  return {
    connected: true,
    status: 'idle',
    activeOperation: null,
    homingRequiredAtBoot: false,
    ...overrides,
  };
}

function unsupportedNativeController(): ControllerCapabilities {
  return {
    output: {
      formats: ['native-binary'],
      jobExecution: 'device-native',
      supportsGcode: false,
      supportsBinary: true,
    },
    laser: {
      powerUnit: 'native',
      maxPowerValue: 0,
      supportsDynamicPower: false,
      supportsConstantPower: false,
      supportsInlinePower: false,
      laserOffOperation: 'native-stop',
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
      supportedKinds: ['native'],
      ackModel: 'device-progress',
    },
  };
}

console.log('\n=== LF-EXT-BCNC-004 controller-family/profile boundaries ===\n');

void (async () => {
  // 1. GRBL keeps its console available because it advertises G-code text.
  {
    const decision = canExecuteOperation('raw-console', grblCapabilities, idleState());
    assert(decision.allowed, 'GRBL raw console is allowed when connected');
  }

  // 2. Non-G-code/native controllers must not inherit the GRBL console path.
  {
    const decision = canExecuteOperation('raw-console', unsupportedNativeController(), idleState());
    assert(!decision.allowed, 'native non-G-code controller refuses raw console');
    assert(!decision.allowed && decision.reason === 'capability-not-supported',
      'raw-console refusal is capability-not-supported');
    assert(/G-code|console/i.test(decisionMessage(decision) ?? ''),
      'raw-console refusal message names G-code/console');
  }

  // 3. WCS normalization is a work-origin mutation and must follow profile capability.
  {
    const noWorkOrigin: ControllerCapabilities = {
      ...grblCapabilities,
      operations: { ...grblCapabilities.operations, canSetWorkOrigin: false },
    };
    const decision = canExecuteOperation('wcs-normalize', noWorkOrigin, idleState());
    assert(!decision.allowed, 'wcs-normalize refused when profile disables work-origin writes');
    assert(!decision.allowed && decision.reason === 'capability-not-supported',
      'wcs-normalize refusal is capability-not-supported');
    assert(/work origin|WCS|coordinate/i.test(decisionMessage(decision) ?? ''),
      'wcs-normalize refusal message names work-origin/WCS');
  }

  // 4. GRBL adapter still rejects wrong-firmware output instead of validating it.
  {
    const findings = getGrblFirmwareAdapter().validate({
      kind: 'gcode-lines',
      firmware: 'marlin',
      lines: ['G21'],
      burnBounds: null,
    }, {
      firmwareVersion: '1.1h',
      buildOptions: null,
      maxSpindle: 1000,
      bedWidthMm: 400,
      bedHeightMm: 300,
      homingEnabled: true,
      laserMode: true,
    }).findings;
    assert(findings.some(f => f.code === 'GRBL_ADAPTER_WRONG_FIRMWARE'),
      'GRBL adapter rejects non-GRBL output');
  }

  // 5. Marlin remains declared-not-supported; it must not borrow GRBL emit/stream behavior.
  {
    const marlin = getMarlinFirmwareAdapter();
    const caps = marlin.capabilities();
    assert(caps.id === 'marlin', 'Marlin stub declares its own firmware id');
    assert(caps.supportsDynamicLaserPower === false, 'Marlin stub does not inherit GRBL M4 dynamic-power support');
    try {
      await marlin.emit(createEmptyPlan('marlin-plan'), createEmptyJob('marlin-job', 'test'));
      assert(false, 'Marlin emit must reject until implemented');
    } catch (error) {
      assert(error instanceof MarlinNotYetSupportedError, 'Marlin emit rejects with typed not-supported error');
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
