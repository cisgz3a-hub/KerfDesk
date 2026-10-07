import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { consumeClaimedFramedRun } from '../state/framed-run-start-consumption';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { testAdapter, resultCode, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter, RemoteCommandResult } from './types';
import type { MachineOperation } from './machine-types';
import { recoveryRepository } from '../state/recovery';
import type * as Recovery from '../state/recovery';
import { useToastStore } from '../state/toast-store';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('../state/recovery', async (importOriginal) => {
  const actual = await importOriginal<typeof Recovery>();
  const testing = await import('../state/recovery/testing');
  return {
    ...actual,
    recoveryRepository: new actual.RecoveryRepository({
      backend: new testing.MemoryRecoveryStorageBackend(),
      generationStore: new testing.MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
    }),
  };
});
const originalStart = useLaserStore.getState().startJob;
let adapter: RemoteControlAdapter;
let controller: AbortController;
let completeImmediately = true;
beforeEach(async () => {
  await recoveryRepository.purgeControllerData();
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useJobReviewStore.getState().close();
  await installReviewPendingFramedRunPermitForCurrentState();
  completeImmediately = true;
  controller = new AbortController();
  const caller = { clientId: 'operator', sessionId: 'session' };
  const authority = {
    ...caller,
    signal: controller.signal,
    assertCurrent: () => controller.signal.throwIfAborted(),
  };
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: () => caller,
    captureMachineAuthority: () => authority,
  });
  useLaserStore.setState({
    startJob: vi.fn(async (gcode, options = {}) => {
      options.assertFinalStartAuthorized?.();
      consumeClaimedFramedRun(
        useLaserStore.setState,
        useLaserStore.getState,
        options.framedRunPermit,
      );
      const stream = createStreamer(gcode);
      const epoch = useLaserStore.getState().streamerEpoch + 1;
      useLaserStore.setState({
        activeRunId: options.runId ?? null,
        streamerEpoch: epoch,
        streamer: {
          ...stream,
          status: completeImmediately ? 'done' : 'streaming',
          completed: completeImmediately ? stream.queued.length : 0,
        },
      });
      options.onStartCommitted?.(options.runId ?? '', epoch);
    }),
  });
});
afterEach(async () => {
  adapter.dispose();
  controller.abort();
  useJobReviewStore.getState().cancelAndClose();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStart });
});
function operation(result: RemoteCommandResult): MachineOperation {
  if (!result.ok) throw new Error(result.error.code);
  return result.data['operation'] as MachineOperation;
}
async function read(id: string) {
  return operation(await adapter.execute('get_control_operation', { operationId: id }));
}
async function reviewing(id: string, oldToken?: string): Promise<MachineOperation> {
  let result!: MachineOperation;
  await vi.waitFor(
    async () => {
      result = await read(id);
      expect(
        result.state,
        JSON.stringify({
          result,
          native: useJobReviewStore.getState().state,
          toasts: useToastStore.getState().toasts,
        }),
      ).toBe('awaiting_review');
      expect(result.review).toBeDefined();
      if (oldToken !== undefined) expect(result.review!.reviewId).not.toBe(oldToken);
    },
    { timeout: 5000, interval: 10 },
  );
  return result;
}

describe('remote Start uses the ordinary exact review and one-use claim', () => {
  it('review pages belong to the same caller and expire with the current one-use review', async () => {
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    const first = await reviewing(args.requestId);
    const request = {
      operationId: args.requestId,
      reviewPage: { reviewId: first.review!.reviewId, offset: 0 },
    };
    expect(
      operation(await adapter.execute('get_control_operation', request)).review?.reviewId,
    ).toBe(first.review!.reviewId);
    expect(
      resultCode(
        await adapter.execute('get_control_operation', request, {
          remoteCaller: { clientId: 'other', sessionId: 'other' },
        }),
      ),
    ).toBe('stale_revision');
    useStore.getState().setLayerParam('red', { power: 33 });
    await reviewing(args.requestId, first.review!.reviewId);
    expect(resultCode(await adapter.execute('get_control_operation', request))).toBe(
      'stale_revision',
    );
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
  });

  it('review alone sends no Start; the displayed acknowledgement and one affirmative token start exactly once', async () => {
    const args = writeArgs(adapter);
    expect(operation(await adapter.execute('review_machine_job', args)).state).toBe('accepted');
    const visible = await reviewing(args.requestId);
    expect(visible.review?.frame).toEqual({ required: true, complete: true });
    const native = useJobReviewStore.getState().state;
    if (native.kind !== 'open') throw new Error('canonical review did not open');
    expect(visible.review?.acknowledgement).toEqual(native.model.acknowledgement);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    const approval = writeArgs(adapter, { reviewId: visible.review!.reviewId });
    await adapter.execute('start_job', approval);
    await vi.waitFor(async () => expect((await read(args.requestId)).state).toBe('completed'), {
      timeout: 5000,
    });
    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
    const receipt = await adapter.execute('start_job', approval);
    expect(operation(receipt).committed).toBe(true);
    expect(
      resultCode(
        await adapter.execute(
          'start_job',
          writeArgs(adapter, { reviewId: visible.review!.reviewId }),
        ),
      ),
    ).toBe('not_found');
    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
    const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]![0];
    expect(recoveryRepository.getSnapshot().activeRun?.artifact.gcode).toBe(gcode);
  });

  it('power/speed edits retain Frame, replace the review token and stream freshly approved bytes', async () => {
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    const first = await reviewing(args.requestId);
    const framed = useLaserStore.getState().completedFrame;
    useStore.getState().setLayerParam('red', { power: 37, speed: 2300 });
    const fresh = await reviewing(args.requestId, first.review!.reviewId);
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(
      resultCode(
        await adapter.execute(
          'start_job',
          writeArgs(adapter, { reviewId: first.review!.reviewId }),
        ),
      ),
    ).toBe('not_found');
    expect(
      resultCode(
        await adapter.execute(
          'start_job',
          writeArgs(adapter, { reviewId: fresh.review!.reviewId }),
        ),
      ),
    ).toBe('ok');
    await vi.waitFor(
      async () =>
        expect(
          useLaserStore.getState().startJob,
          JSON.stringify({
            result: await read(args.requestId),
            native: useJobReviewStore.getState().state,
            toasts: useToastStore.getState().toasts,
          }),
        ).toHaveBeenCalledTimes(1),
      { timeout: 5000 },
    );
    const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]![0];
    expect(gcode).toMatch(/S370(?:\s|$)/);
    expect(gcode).toMatch(/F2300/);
  }, 15_000);

  it('hot machine facts changed at Start rebuild the exact model and require another explicit confirmation', async () => {
    useLaserStore.setState({ controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 } });
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    const first = await reviewing(args.requestId);
    expect(first.review!.acknowledgement.kind).toBe('laser-verified');
    useLaserStore.setState((state) => ({
      controllerSettings: { ...state.controllerSettings!, laserModeEnabled: false },
      controllerSettingsObservation: { sessionEpoch: 7, observedAt: 2 },
    }));
    expect(
      resultCode(
        await adapter.execute(
          'start_job',
          writeArgs(adapter, { reviewId: first.review!.reviewId }),
        ),
      ),
    ).toBe('ok');
    const refreshed = await reviewing(args.requestId, first.review!.reviewId);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(refreshed.review!.acknowledgement).toMatchObject({
      kind: 'laser-unverified',
      prompt: expect.stringContaining('Start this laser job anyway?'),
    });
    await adapter.execute(
      'start_job',
      writeArgs(adapter, { reviewId: refreshed.review!.reviewId }),
    );
    await vi.waitFor(() => expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
  }, 15_000);

  it('revoked pre-Start control closes only its own review and cannot stream', async () => {
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    await reviewing(args.requestId);
    controller.abort();
    await vi.waitFor(async () => expect((await read(args.requestId)).state).toBe('cancelled'));
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
  });

  it('revoking remote control after accepted ordinary streaming does not automatically Abort the running job', async () => {
    completeImmediately = false;
    const stop = vi.spyOn(useLaserStore.getState(), 'stopJob').mockResolvedValue();
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    const shown = await reviewing(args.requestId);
    await adapter.execute('start_job', writeArgs(adapter, { reviewId: shown.review!.reviewId }));
    await vi.waitFor(async () =>
      expect(await read(args.requestId)).toMatchObject({ state: 'running', committed: true }),
    );
    controller.abort();
    expect(stop).not.toHaveBeenCalled();
    useLaserStore.setState((state) => ({
      streamer: { ...state.streamer!, status: 'done', completed: state.streamer!.queued.length },
    }));
    await vi.waitFor(async () =>
      expect(await read(args.requestId)).toMatchObject({ state: 'completed', committed: true }),
    );
    stop.mockRestore();
  });
});
