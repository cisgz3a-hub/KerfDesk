import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startMotionOperation } from '../state/laser-motion-operation';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { MachineAuthority, MachineCommand } from './machine-types';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { RemoteControlAdapter } from './types';

const execution = vi.hoisted(() => vi.fn());
vi.mock('./machine-execution', () => ({ executeMachineOperation: execution }));

let adapter: RemoteControlAdapter;
const cancelJog = vi.fn(async () => undefined);
const motion = startMotionOperation('jog');
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState(initialLaserState());
  cancelJog.mockClear();
  useLaserStore.setState({ cancelJog });
  const controller = new AbortController();
  const authority: MachineAuthority = {
    clientId: 'client',
    sessionId: 'session',
    signal: controller.signal,
    assertCurrent: () => controller.signal.throwIfAborted(),
  };
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: () => ({ clientId: authority.clientId, sessionId: authority.sessionId }),
    captureMachineAuthority: () => authority,
  });
  execution
    .mockReset()
    .mockImplementation(async (_input: MachineCommand, operation: OwnedMachineOperation) => {
      operation.state = 'completed';
    });
});
afterEach(() => {
  adapter.dispose();
  useLaserStore.setState(initialLaserState());
});

async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}
async function abort() {
  const result = await adapter.execute('abort_job', { requestId: crypto.randomUUID() });
  await flush();
  return resultCode(result);
}
async function hold() {
  const args = writeArgs(adapter, { axis: 'x', direction: 1 });
  expect(resultCode(await adapter.execute('jog_hold_start', args))).toBe('ok');
  await flush();
  return args.requestId;
}

it('normal held-jog stops preserve the whole Abort reserve and still work when it is exhausted', async () => {
  const first = await hold();
  const args = { requestId: crypto.randomUUID(), operationId: first };
  expect(resultCode(await adapter.execute('jog_hold_stop', args))).toBe('ok');
  expect(resultCode(await adapter.execute('jog_hold_stop', args))).toBe('ok');
  for (let index = 0; index < 256; index++) expect(await abort()).toBe('ok');
  expect(await abort()).toBe('failed');
  const next = await hold();
  expect(
    resultCode(
      await adapter.execute('jog_hold_stop', {
        requestId: crypto.randomUUID(),
        operationId: next,
      }),
    ),
  ).toBe('ok');
});

it('a held jog can stop after ordinary saturation without replay spending reserve twice', async () => {
  for (let index = 0; index < 4095; index++) {
    const result = await adapter.execute(
      'jog_machine',
      writeArgs(adapter, { axis: 'x', direction: 1, distanceMm: 1 }),
    );
    expect(resultCode(result)).toBe('ok');
    await flush();
  }
  execution.mockImplementation(async (input: MachineCommand, operation: OwnedMachineOperation) => {
    if (input.command === 'jog_hold_start') {
      operation.state = 'running';
      operation.committed = true;
      operation.motionId = motion.operationId;
      useLaserStore.setState({ motionOperation: motion });
    } else operation.state = 'completed';
  });
  const operationId = await hold();
  const stop = { requestId: crypto.randomUUID(), operationId };
  expect(resultCode(await adapter.execute('jog_hold_stop', stop))).toBe('ok');
  expect(cancelJog).toHaveBeenCalled();
  const cancellations = cancelJog.mock.calls.length;
  expect(resultCode(await adapter.execute('jog_hold_stop', stop))).toBe('ok');
  expect(cancelJog).toHaveBeenCalledTimes(cancellations);
  for (let index = 0; index < 255; index++) expect(await abort()).toBe('ok');
  expect(await abort()).toBe('failed');
  expect(
    resultCode(
      await adapter.execute('jog_hold_stop', { requestId: crypto.randomUUID(), operationId }),
    ),
  ).toBe('failed');
  expect(resultCode(await adapter.execute('jog_hold_stop', stop))).toBe('ok');
}, 20_000);
