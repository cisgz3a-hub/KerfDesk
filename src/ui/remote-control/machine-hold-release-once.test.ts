import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { settleTestGrblHandshake } from '../state/laser-test-start-helpers';
import { useStore } from '../state/store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

// Rolling audit v2 01-P2-6: one hold release ran the native Cancel twice. The
// second attempt replaced the first, whose rejection marked the receipt
// "could not be confirmed" until the stop settled; a phone poll in that window
// warned about a routine release and stopped following the receipt.
const DECEL_MS = 150;
const CALLER = { clientId: 'phone', sessionId: 'session' };

let controllerState: 'Idle' | 'Jog';
let written: string[];
let cancels: number;
let adapter: RemoteControlAdapter;
let heartbeat: ReturnType<typeof setInterval> | undefined;
const nativeCancelJog = useLaserStore.getState().cancelJog;

// A GRBL that runs a jog until 0x85, then decelerates for DECEL_MS.
function fakeGrbl(): FakeConnection {
  const connection: FakeConnection = makeConnection(async (data) => {
    if (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake') return;
    written.push(data);
    const emit = connection.emitLine;
    if (data === '?') {
      setTimeout(() => emit(`<${controllerState}|MPos:0.000,0.000,0.000|FS:0,0>`), 0);
    } else if (data.startsWith('$J=')) {
      setTimeout(() => {
        controllerState = 'Jog';
        emit('ok');
      }, 2);
    } else if (data === RT_JOG_CANCEL) {
      if (controllerState === 'Jog') setTimeout(() => (controllerState = 'Idle'), DECEL_MS);
    } else if (data.startsWith('G4')) {
      const acknowledge = () =>
        controllerState === 'Idle' ? emit('ok') : setTimeout(acknowledge, 5);
      setTimeout(acknowledge, 2);
    } else if (data.endsWith('\n')) setTimeout(() => emit('ok'), 1);
  });
  return connection;
}

beforeEach(async () => {
  controllerState = 'Idle';
  written = [];
  cancels = 0;
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState({ ...initialLaserState(), cancelJog: nativeCancelJog });
  await connectWith(fakeGrbl());
  await settleTestGrblHandshake();
  useLaserStore.setState({
    cancelJog: () => {
      cancels += 1;
      return nativeCancelJog();
    },
  });
  const grant = new AbortController();
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: () => CALLER,
    captureMachineAuthority: () => ({
      ...CALLER,
      signal: grant.signal,
      assertCurrent: () => grant.signal.throwIfAborted(),
    }),
  });
});

afterEach(async () => {
  clearInterval(heartbeat);
  adapter.dispose();
  useLaserStore.setState({ cancelJog: nativeCancelJog });
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
});

async function startHold(): Promise<string> {
  const args = writeArgs(adapter, { axis: 'x', direction: 1 });
  expect(resultCode(await adapter.execute('jog_hold_start', args))).toBe('ok');
  heartbeat = setInterval(() => adapter.holdBeat?.(CALLER.clientId, args.requestId), 150);
  await expect.poll(() => controllerState, { timeout: 3000 }).toBe('Jog');
  return args.requestId;
}

async function receipt(operationId: string): Promise<{ state: string; message?: string }> {
  const result = await adapter.execute('get_control_operation', { operationId });
  if (!result.ok) throw new Error(result.error.code);
  return (result.data as { operation: { state: string; message?: string } }).operation;
}

/** Every receipt state a phone could poll until the hold settles. */
async function statesUntilSettled(operationId: string): Promise<string[]> {
  const seen: string[] = [];
  for (let index = 0; index < 1000; index++) {
    const { state, message } = await receipt(operationId);
    const entry = message === undefined ? state : `${state} | ${message}`;
    if (seen.at(-1) !== entry) seen.push(entry);
    if (state === 'completed' || state === 'failed' || state === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  return seen;
}

describe('ADR-585 hold release: one release, one Cancel', () => {
  it('a jog_hold_stop cancels once and never reports an unconfirmed stop', async () => {
    const operationId = await startHold();
    clearInterval(heartbeat);

    const stop = { requestId: crypto.randomUUID(), operationId };
    expect(resultCode(await adapter.execute('jog_hold_stop', stop))).toBe('ok');
    const states = await statesUntilSettled(operationId);

    expect(cancels).toBe(1);
    expect(states.some((state) => state.startsWith('unknown'))).toBe(false);
    expect(states.at(-1)).toBe('completed | Stopped.');
    expect(written).toContain(RT_JOG_CANCEL);
  });

  it('the socket release followed by jog_hold_stop is still one Cancel', async () => {
    const operationId = await startHold();
    clearInterval(heartbeat);

    adapter.holdRelease?.(CALLER.clientId);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const stop = { requestId: crypto.randomUUID(), operationId };
    expect(resultCode(await adapter.execute('jog_hold_stop', stop))).toBe('ok');
    const states = await statesUntilSettled(operationId);

    expect(cancels).toBe(1);
    expect(states.some((state) => state.startsWith('unknown'))).toBe(false);
    expect(states.at(-1)).toBe('completed | Stopped.');
  });
});
