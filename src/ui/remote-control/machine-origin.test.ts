// Remote Set origin / Zero Z keep the guards the PC wraps around the same store
// actions (rolling audit 2026-10-21 01-P2-1 and 01-P2-2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl/status-parser';
import { REMOTE_ZERO_Z_REFUSAL } from '../laser/zero-z-guard';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
const initial = useLaserStore.getState();
const zeroZHere = vi.fn(async () => undefined);
const setOriginHere = vi.fn(async () => undefined);
const EPOCH = 3;

function idleAt(z: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: null,
    wPos: { x: 0, y: 0, z },
    feed: null,
    spindle: null,
  } as StatusReport;
}
async function receipt(requestId: string) {
  return adapter.execute('get_control_operation', { operationId: requestId });
}
async function settled(requestId: string, state: 'completed' | 'failed') {
  await vi.waitFor(async () => {
    expect(await receipt(requestId)).toMatchObject({ ok: true, data: { operation: { state } } });
  });
  const result = await receipt(requestId);
  if (!result.ok) throw new Error('No receipt.');
  return result.data.operation as { committed: boolean | null; message?: string };
}

beforeEach(() => {
  zeroZHere.mockReset().mockResolvedValue(undefined);
  setOriginHere.mockReset().mockResolvedValue(undefined);
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().setJobPlacement({ startFrom: 'absolute' });
  useLaserStore.setState(
    {
      ...initial,
      zeroZHere,
      setOriginHere,
      connection: { kind: 'connected' },
      workZReferenceEpoch: EPOCH,
      workZZeroEvidence: null,
      statusReport: idleAt(0),
    } as Partial<typeof initial> as typeof initial,
    true,
  );
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

describe('remote Zero Z keeps the PC overwrite guard (01-P2-1)', () => {
  it('refuses, writing nothing, when it would replace a probed Z0 from the retract height', async () => {
    useLaserStore.setState({
      workZZeroEvidence: { source: 'probe', referenceEpoch: EPOCH, probePlateRemoved: true },
      statusReport: idleAt(20),
    });
    const args = writeArgs(adapter, { axes: 'z' });
    await adapter.execute('set_work_origin', args);
    const operation = await settled(args.requestId, 'failed');
    expect(operation).toMatchObject({ committed: false, message: REMOTE_ZERO_Z_REFUSAL });
    expect(zeroZHere).not.toHaveBeenCalled();
    expect(useLaserStore.getState().workZZeroEvidence?.source).toBe('probe');
  });

  it('refuses over a probed zero whose bit height is unknown', async () => {
    useLaserStore.setState({
      workZZeroEvidence: { source: 'probe', referenceEpoch: EPOCH, probePlateRemoved: true },
      statusReport: null,
    });
    const args = writeArgs(adapter, { axes: 'z' });
    await adapter.execute('set_work_origin', args);
    expect(await settled(args.requestId, 'failed')).toMatchObject({ committed: false });
    expect(zeroZHere).not.toHaveBeenCalled();
  });

  it.each([
    ['a first zero', null, 20],
    ['a correction at the zero', { source: 'manual-zero', referenceEpoch: EPOCH } as const, 0.2],
  ])('zeros Z for %s, where the PC asks nothing', async (_label, evidence, z) => {
    useLaserStore.setState({ workZZeroEvidence: evidence, statusReport: idleAt(z) });
    const args = writeArgs(adapter, { axes: 'z' });
    await adapter.execute('set_work_origin', args);
    expect(await settled(args.requestId, 'completed')).toMatchObject({ committed: true });
    expect(zeroZHere).toHaveBeenCalledOnce();
  });
});

describe('remote Set origin switches Start from like the PC (01-P2-2)', () => {
  it('upgrades Absolute to User Origin once the controller confirms', async () => {
    expect(useStore.getState().jobPlacement.startFrom).toBe('absolute');
    const args = writeArgs(adapter, { axes: 'xy' });
    await adapter.execute('set_work_origin', args);
    await settled(args.requestId, 'completed');
    expect(setOriginHere).toHaveBeenCalledOnce();
    expect(useStore.getState().jobPlacement.startFrom).toBe('user-origin');
  });

  it('keeps an explicit Current Position choice', async () => {
    useStore.getState().setJobPlacement({ startFrom: 'current-position' });
    const args = writeArgs(adapter, { axes: 'xy' });
    await adapter.execute('set_work_origin', args);
    await settled(args.requestId, 'completed');
    expect(useStore.getState().jobPlacement.startFrom).toBe('current-position');
  });

  it('leaves Absolute alone when the request failed', async () => {
    setOriginHere.mockRejectedValueOnce(new Error('Set origin was not acknowledged.'));
    const args = writeArgs(adapter, { axes: 'xy' });
    await adapter.execute('set_work_origin', args);
    await vi.waitFor(async () => {
      const result = await receipt(args.requestId);
      expect(result.ok && (result.data.operation as { state: string }).state).not.toMatch(
        /accepted|running/,
      );
    });
    expect(useStore.getState().jobPlacement.startFrom).toBe('absolute');
  });

  it('does not rewrite a document opened while the origin was being set', async () => {
    let acknowledge!: () => void;
    setOriginHere.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (acknowledge = () => resolve(undefined))),
    );
    const args = writeArgs(adapter, { axes: 'xy' });
    await adapter.execute('set_work_origin', args);
    await vi.waitFor(() => expect(setOriginHere).toHaveBeenCalledOnce());
    useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
    acknowledge();
    await vi.waitFor(async () => {
      const result = await receipt(args.requestId);
      expect(result.ok && (result.data.operation as { state: string }).state).not.toBe('running');
    });
    expect(useStore.getState().jobPlacement.startFrom).toBe('absolute');
  });
});
