/**
 * LF-EXT-UGS-006: UGS-style profile gates for machine-control commands.
 *
 * The contract is intentionally compatibility-friendly:
 * - homing/unlock/set-origin are profile/capability-gated;
 * - WCS normalization/reset stays available on idle connected GRBL paths;
 * - WCS reset fails closed when no controller operation exists.
 *
 * Run: npx tsx tests/wcs-profile-gate-contract.test.ts
 */
import {
  canExecuteOperation,
  type OperationGateMachineState,
} from '../src/app/OperationGate';
import { sendResetWcsCommand } from '../src/app/sendResetWcsCommand';
import {
  grblCapabilities,
  type ControllerCapabilities,
} from '../src/controllers/ControllerCapabilities';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function state(
  overrides: Partial<OperationGateMachineState> = {},
): OperationGateMachineState {
  return {
    connected: true,
    status: 'idle',
    activeOperation: null,
    homingRequiredAtBoot: false,
    ...overrides,
  };
}

function withOperation(
  operation: keyof ControllerCapabilities['operations'],
  supported: boolean,
): ControllerCapabilities {
  return {
    ...grblCapabilities,
    operations: {
      ...grblCapabilities.operations,
      [operation]: supported,
    },
  };
}

async function run(): Promise<void> {
  console.log('\n=== WCS/profile operation gate contract ===\n');

  {
    const d = canExecuteOperation('home', withOperation('canHome', false), state());
    assert(!d.allowed && d.reason === 'capability-not-supported', 'home is blocked when profile disables homing');
  }

  {
    const d = canExecuteOperation('unlock', withOperation('canUnlock', false), state({ status: 'alarm' }));
    assert(!d.allowed && d.reason === 'capability-not-supported', 'unlock is blocked when profile disables unlock');
  }

  {
    const d = canExecuteOperation('set-origin', withOperation('canSetWorkOrigin', false), state());
    assert(!d.allowed && d.reason === 'capability-not-supported', 'set-origin is blocked when profile disables work-origin writes');
  }

  {
    const d = canExecuteOperation('wcs-normalize', grblCapabilities, state({ status: 'run' }));
    assert(!d.allowed && d.reason === 'machine-state-prevents', 'WCS normalize is blocked while machine is running');
  }

  {
    const d = canExecuteOperation('wcs-normalize', grblCapabilities, state());
    assert(d.allowed, 'WCS normalize remains available while idle so the reset-baseline button is not over-gated');
  }

  {
    const result = await sendResetWcsCommand(
      { operations: {} } as Parameters<typeof sendResetWcsCommand>[0],
    );
    assert(!result.ok && result.reason === 'no-controller', 'reset WCS fails closed if the controller operation is absent');
  }

  {
    const result = await sendResetWcsCommand({
      operations: {
        resetWcsToMachineOrigin: async () => ({
          ok: false as const,
          reason: 'unsupported',
          message: 'Controller does not support reset WCS.',
        }),
      },
    });
    assert(!result.ok && result.reason === 'unsupported', 'reset WCS surfaces controller-level unsupported refusals');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
