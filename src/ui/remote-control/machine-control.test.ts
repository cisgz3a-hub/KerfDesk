import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { testAdapter, resultCode, writeArgs } from './authoring-test-support';
import type { MachineAuthority, MachineOperation } from './machine-types';
import type { RemoteControlAdapter, RemoteCommandResult } from './types';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import type { MachineExecutionContext } from './machine-execution';

const execution = vi.hoisted(() => vi.fn());
vi.mock('./machine-execution', () => ({ executeMachineOperation: execution }));
let adapter: RemoteControlAdapter;
let controller: AbortController;
let authority: MachineAuthority;
const caller = () => ({ clientId: authority.clientId, sessionId: authority.sessionId });
function ownClient(id = 'client-a') {
  controller = new AbortController();
  const ownedController = controller;
  authority = {
    clientId: id,
    sessionId: 'session',
    signal: controller.signal,
    assertCurrent: () => ownedController.signal.throwIfAborted(),
  };
}
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState(initialLaserState());
  ownClient();
  execution
    .mockReset()
    .mockImplementation(async (_input: MachineCommand, operation: OwnedMachineOperation) => {
      operation.state = 'completed';
    });
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: caller,
    captureMachineAuthority: () => authority,
  });
});
afterEach(() => {
  adapter.dispose();
  useLaserStore.setState(initialLaserState());
  useFramePreparationStore.setState({ pending: false });
});
function operation(result: RemoteCommandResult): MachineOperation {
  if (!result.ok) throw new Error(result.error.code);
  return result.data['operation'] as MachineOperation;
}
function jog() {
  return writeArgs(adapter, { axis: 'x', direction: 1, distanceMm: 1 });
}
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('machine receipts and control admission', () => {
  it('a handed-off ordinary job receipt does not add a registry ban to native-permitted jogging', async () => {
    let finish!: () => void;
    execution.mockImplementation(async (input: MachineCommand, owned: OwnedMachineOperation) => {
      if (input.command === 'review_machine_job') {
        owned.state = 'running';
        owned.committed = true;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      } else owned.state = 'completed';
    });
    const job = writeArgs(adapter);
    await adapter.execute('review_machine_job', job);
    await flush();
    expect(resultCode(await adapter.execute('jog_machine', jog()))).toBe('ok');
    await flush();
    expect(
      operation(await adapter.execute('get_control_operation', { operationId: job.requestId })),
    ).toMatchObject({ kind: 'job', state: 'running', committed: true });
    expect(execution).toHaveBeenCalledTimes(2);
    finish();
    await flush();
  });
  it('control does not depend on edit or Pro and repeated identity dispatches exactly once', async () => {
    const args = jog();
    const first = await adapter.execute('jog_machine', args);
    const second = await adapter.execute('jog_machine', args);
    expect(operation(first).operationId).toBe(args.requestId);
    expect(operation(second).operationId).toBe(args.requestId);
    expect(execution).toHaveBeenCalledTimes(1);
    expect(resultCode(await adapter.execute('jog_machine', { ...args, distanceMm: 2 }))).toBe(
      'request_conflict',
    );
    expect(execution).toHaveBeenCalledTimes(1);
  });

  it('a read/edit grant or wrong caller cannot gain machine authority', async () => {
    expect(
      resultCode(await adapter.execute('jog_machine', jog(), { machineAuthority: null })),
    ).toBe('control_required');
    expect(
      resultCode(
        await adapter.execute('jog_machine', jog(), {
          remoteCaller: { ...caller(), clientId: 'other' },
        }),
      ),
    ).toBe('control_required');
    expect(execution).not.toHaveBeenCalled();
  });

  it('missing, other-client and old-session receipts remain unknown with unconfirmed dispatch', async () => {
    const args = jog();
    await adapter.execute('jog_machine', args);
    const missing = await adapter.execute('get_control_operation', {
      operationId: crypto.randomUUID(),
    });
    expect(operation(missing)).toMatchObject({ state: 'unknown', committed: null });
    const other = await adapter.execute(
      'get_control_operation',
      { operationId: args.requestId },
      { remoteCaller: { clientId: 'other', sessionId: 'session' } },
    );
    const previous = await adapter.execute(
      'get_control_operation',
      { operationId: args.requestId },
      { remoteCaller: { clientId: 'client-a', sessionId: 'old' } },
    );
    expect(operation(other)).toMatchObject({ state: 'unknown', committed: null });
    expect(operation(previous)).toMatchObject({ state: 'unknown', committed: null });
    expect(execution).toHaveBeenCalledTimes(1);
  });

  it('revocation after an accepted receipt prevents delayed preparation from dispatching', async () => {
    let release!: () => void;
    let dispatched = 0;
    execution.mockImplementation(
      async (
        _input: MachineCommand,
        owned: OwnedMachineOperation,
        context: MachineExecutionContext,
      ) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        context.assertOwned(owned);
        dispatched++;
      },
    );
    const args = jog();
    expect(operation(await adapter.execute('jog_machine', args)).state).toBe('accepted');
    controller.abort();
    release();
    await flush();
    expect(dispatched).toBe(0);
    expect(
      operation(await adapter.execute('get_control_operation', { operationId: args.requestId })),
    ).toMatchObject({ state: 'cancelled', committed: false });
  });

  it('Abort ignores a document epoch change before its queued execution', async () => {
    execution.mockImplementation(
      async (
        _input: MachineCommand,
        owned: OwnedMachineOperation,
        context: MachineExecutionContext,
      ) => {
        useStore.setState((state) => ({ projectDocumentEpoch: state.projectDocumentEpoch + 1 }));
        context.assertOwned(owned);
        owned.state = 'completed';
      },
    );
    const requestId = crypto.randomUUID();
    await adapter.execute('abort_job', { requestId });
    await flush();
    expect(
      operation(await adapter.execute('get_control_operation', { operationId: requestId })),
    ).toMatchObject({ state: 'completed', committed: false });
  });

  it('a remote Frame cannot join an existing ordinary Frame owner', async () => {
    useFramePreparationStore.setState({ pending: true });
    expect(resultCode(await adapter.execute('frame_job', writeArgs(adapter)))).toBe('busy');
    expect(execution).not.toHaveBeenCalled();
    useFramePreparationStore.setState({ pending: false });
  });

  it('normal saturation preserves Abort capacity and a fresh client has its own budget', async () => {
    for (let index = 0; index < 4096; index++) {
      await adapter.execute('jog_machine', jog());
      await flush();
    }
    expect(resultCode(await adapter.execute('jog_machine', jog()))).toBe('failed');
    expect(resultCode(await adapter.execute('abort_job', { requestId: crypto.randomUUID() }))).toBe(
      'ok',
    );
    await flush();
    expect(execution).toHaveBeenCalledTimes(4097);
    controller.abort();
    ownClient('fresh-pair');
    expect(resultCode(await adapter.execute('jog_machine', jog()))).toBe('ok');
    expect(execution).toHaveBeenCalledTimes(4098);
  }, 20_000);
});
