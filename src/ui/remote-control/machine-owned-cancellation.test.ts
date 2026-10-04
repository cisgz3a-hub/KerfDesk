import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startMotionOperation } from '../state/laser-motion-operation';
import { connectWith, makeConnection } from '../state/laser-store-motion-operation.test-support';
import {
  respondToTestGrblHandshake,
  settleTestGrblHandshake,
} from '../state/laser-test-start-helpers';
import { useStore } from '../state/store';
import { cancelMachineOperation } from './machine-owned-operation';
import type { OwnedMachineOperation } from './machine-operation-state';

const nativeCancel = useLaserStore.getState().cancelJog;
let unsubscribe: () => void = () => undefined;
let cancellation: Promise<void> | undefined;
let sent: string[];
beforeEach(async () => {
  sent = [];
  cancellation = undefined;
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState({ ...initialLaserState(), cancelJog: nativeCancel });
  const device = makeConnection(async (data) => {
    sent.push(data);
    respondToTestGrblHandshake(data, device.emitLine);
    if (data === '?') setTimeout(() => device.emitLine('<Idle|MPos:0,0,0|FS:0,0>'), 0);
    if (data === 'G4 P0.01\n') setTimeout(() => device.emitLine('ok'), 0);
  });
  await connectWith(device);
  await settleTestGrblHandshake();
  sent.length = 0;
  useLaserStore.setState({
    cancelJog: () => {
      cancellation = nativeCancel();
      return cancellation;
    },
  });
});
afterEach(async () => {
  unsubscribe();
  await cancellation?.catch(() => undefined);
  useLaserStore.setState({ motionOperation: null, cancelJog: nativeCancel });
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});
function ownedJog(): OwnedMachineOperation {
  const motion = { ...startMotionOperation('jog'), dispatchComplete: true };
  useLaserStore.setState({ motionOperation: motion });
  const grant = new AbortController();
  return {
    authority: {
      clientId: 'phone',
      sessionId: 'session',
      signal: grant.signal,
      assertCurrent: () => grant.signal.throwIfAborted(),
    },
    controller: new AbortController(),
    documentEpoch: useStore.getState().projectDocumentEpoch,
    controllerEpoch: useLaserStore.getState().controllerSessionEpoch,
    motionId: motion.operationId,
    kind: 'jog',
    state: 'running',
    committed: true,
    cleanup: () => undefined,
  };
}
describe('remote cancellation retains the exact native motion owner', () => {
  it('the actual Cancel byte rechecks ownership after pending-write publication on the same controller', async () => {
    const operation = ownedJog();
    const replacement = startMotionOperation('jog');
    let replaced = false;
    unsubscribe = useLaserStore.subscribe((state) => {
      if (
        replaced ||
        state.pendingTransportWrites !== 1 ||
        state.motionOperation?.cancelAttemptId === undefined
      )
        return;
      replaced = true;
      useLaserStore.setState({ motionOperation: replacement });
    });
    cancelMachineOperation(operation);
    await expect(cancellation).rejects.toThrow(/cancellation was replaced/i);
    expect(replaced).toBe(true);
    expect(sent).not.toContain(RT_JOG_CANCEL);
    expect(useLaserStore.getState().motionOperation).toBe(replacement);
  });
  it('runs canonical Cancel and settlement for the unchanged owned motion', async () => {
    const operation = ownedJog();
    cancelMachineOperation(operation);
    expect(cancellation).toBeDefined();
    await cancellation;
    expect(sent).toContain(RT_JOG_CANCEL);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });
  it('synchronous publication cannot send Cancel to a replacement controller/motion', () => {
    const operation = ownedJog();
    const replacement = startMotionOperation('jog');
    let replaced = false;
    unsubscribe = useLaserStore.subscribe((state) => {
      if (replaced || state.motionOperation?.cancelRequested !== true) return;
      replaced = true;
      useLaserStore.setState({
        controllerSessionEpoch: operation.controllerEpoch + 1,
        motionOperation: replacement,
      });
    });
    cancelMachineOperation(operation);
    expect(replaced).toBe(true);
    expect(cancellation).toBeUndefined();
    expect(sent).not.toContain(RT_JOG_CANCEL);
    expect(useLaserStore.getState().motionOperation).toBe(replacement);
  });
});
