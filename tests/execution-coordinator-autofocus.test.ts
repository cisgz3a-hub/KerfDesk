/**
 * ExecutionCoordinator.autoFocus facade (T2-4 phase 6).
 * Run: npx tsx tests/execution-coordinator-autofocus.test.ts
 */
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { type MachineService } from '../src/app/MachineService';
import { type LaserController } from '../src/controllers/ControllerInterface';

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

function makeCoordinator(machineService: MachineService): ExecutionCoordinator {
  const controllerRef = { current: null } as { current: LaserController | null };
  return new ExecutionCoordinator({
    machineService,
    controllerRef,
    notifySimulatorRef: { current: () => {} },
  });
}

void (async () => {
  console.log('\n=== execution-coordinator autofocus facade ===\n');

  {
    const machineService = {
      autoFocus: async () => ({ ok: true as const }),
    } as unknown as MachineService;
    const coord = makeCoordinator(machineService);
    const r = await coord.autoFocus();
    assert(r.ok === true, 'pass-through: { ok: true }');
  }

  {
    const machineService = {
      autoFocus: async () => ({ ok: false as const, error: 'x' }),
    } as unknown as MachineService;
    const coord = makeCoordinator(machineService);
    const r = await coord.autoFocus();
    assert(r.ok === false && 'error' in r && r.error === 'x', 'pass-through: { ok: false, error }');
  }

  {
    const machineService = {
      autoFocus: async () => {
        throw new Error('boom');
      },
    } as unknown as MachineService;
    const coord = makeCoordinator(machineService);
    let threw = false;
    try {
      await coord.autoFocus();
    } catch (e) {
      threw = e instanceof Error && e.message === 'boom';
    }
    assert(threw, 'propagates throw from machineService.autoFocus');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
