import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
const initial = useLaserStore.getState();
const disconnect = vi.fn(async () => undefined);
beforeEach(() => {
  disconnect.mockClear();
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState({ ...initial, disconnect, connection: { kind: 'connected' } }, true);
  const controller = new AbortController();
  const caller = { clientId: 'phone', sessionId: 'renderer' };
  adapter = testAdapter({
    getRemoteCaller: () => caller,
    captureMachineAuthority: () => ({
      ...caller,
      signal: controller.signal,
      assertCurrent: () => controller.signal.throwIfAborted(),
    }),
  });
});
afterEach(() => {
  adapter.dispose();
  useLaserStore.setState(initial, true);
});

it.each(['home', 'ack', 'transport'] as const)(
  'refuses remote disconnect while local %s owns the controller',
  async (kind) => {
    if (kind === 'home')
      useLaserStore.setState({
        controllerOperation: { kind: 'home', phase: 'command', operationId: 1, idleReports: 0 },
      });
    else if (kind === 'ack') useLaserStore.setState({ pendingUntrackedAcks: 1 });
    else useLaserStore.setState({ pendingTransportWrites: 1 });
    expect(await adapter.execute('get_machine_status', {})).toMatchObject({
      ok: true,
      data: { availability: { disconnect: { available: false } } },
    });
    const args = writeArgs(adapter);
    await adapter.execute('disconnect_machine', args);
    await vi.waitFor(async () => {
      const receipt = await adapter.execute('get_control_operation', {
        operationId: args.requestId,
      });
      expect(receipt).toMatchObject({
        ok: true,
        data: { operation: { state: 'failed', committed: false } },
      });
    });
    expect(disconnect).not.toHaveBeenCalled();
    if (kind === 'home') expect(useLaserStore.getState().controllerOperation?.kind).toBe('home');
  },
);

it('disconnects an unowned connection once and reports completion', async () => {
  const args = writeArgs(adapter);
  await adapter.execute('disconnect_machine', args);
  await vi.waitFor(async () => {
    expect(
      await adapter.execute('get_control_operation', { operationId: args.requestId }),
    ).toMatchObject({
      ok: true,
      data: { operation: { state: 'completed', committed: true } },
    });
  });
  expect(disconnect).toHaveBeenCalledOnce();
});
