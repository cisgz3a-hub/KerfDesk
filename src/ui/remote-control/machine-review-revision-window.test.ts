import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import type { TextRenderResult } from '../../core/text';
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

const render = vi.hoisted(() => vi.fn());
vi.mock('../text/render-text-geometry', () => ({ renderTextGeometry: render }));
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
beforeEach(async () => {
  await recoveryRepository.purgeControllerData();
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useStore.getState().setLayerParam('red', { power: 27.5, speed: 1700 });
  useJobReviewStore.getState().close();
  await installReviewPendingFramedRunPermitForCurrentState();
  controller = new AbortController();
  const caller = { clientId: 'operator', sessionId: 'session' };
  const authority = {
    ...caller,
    signal: controller.signal,
    assertCurrent: () => controller.signal.throwIfAborted(),
  };
  adapter = testAdapter({
    getRemoteCaller: () => caller,
    captureMachineAuthority: () => authority,
  });
  render.mockReset();
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
        streamer: { ...stream, status: 'done', completed: stream.queued.length },
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
async function fillWindow(count: number): Promise<void> {
  for (let i = 0; i < count; i++)
    expect(
      resultCode(await adapter.execute('set_selection', writeArgs(adapter, { artworkIds: [] }))),
    ).toBe('ok');
}
async function read(id: string): Promise<MachineOperation> {
  return operation(await adapter.execute('get_control_operation', { operationId: id }));
}
async function reviewing(id: string, oldHandle?: string): Promise<MachineOperation> {
  let result!: MachineOperation;
  await vi.waitFor(
    async () => {
      result = await read(id);
      expect(result.state).toBe('awaiting_review');
      expect(result.review).toBeDefined();
      if (oldHandle !== undefined) expect(result.review!.reviewId).not.toBe(oldHandle);
    },
    { timeout: 5000, interval: 10 },
  );
  return result;
}

describe('edit-window renewal keeps the canonical remote review recoverable', () => {
  it.each([255, 256])(
    'refreshes the review after %s prior writes and starts only a freshly confirmed exact program',
    async (count) => {
      await fillWindow(count);
      const args = writeArgs(adapter);
      await adapter.execute('review_machine_job', args);
      const first = await reviewing(args.requestId);
      const before = useStore.getState();
      const framed = useLaserStore.getState().completedFrame;
      const renewed = await adapter.execute(
        'set_selection',
        writeArgs(adapter, { artworkIds: [] }),
      );
      expect(resultCode(renewed)).toBe(count === 256 ? 'stale_revision' : 'ok');
      const fresh = await reviewing(args.requestId, first.review!.reviewId);
      expect(fresh.review!.revision).toBe(adapter.getRevision());
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().dirty).toBe(before.dirty);
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
      const approval = writeArgs(adapter, { reviewId: fresh.review!.reviewId });
      expect(resultCode(await adapter.execute('start_job', approval))).toBe('ok');
      await vi.waitFor(async () => expect((await read(args.requestId)).state).toBe('completed'), {
        timeout: 5000,
      });
      expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
      const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]![0];
      expect(gcode).toMatch(/S275(?:\s|$)/);
      expect(gcode).toMatch(/F1700/);
      expect(recoveryRepository.getSnapshot().activeRun?.artifact.gcode).toBe(gcode);
      expect(operation(await adapter.execute('start_job', approval)).committed).toBe(true);
      expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
    },
    15_000,
  );

  it('keeps an unresolved text write and its revision rather than renewing a full pending window', async () => {
    await fillWindow(255);
    let finish!: (geometry: TextRenderResult) => void;
    render.mockImplementation(
      () =>
        new Promise<TextRenderResult>((resolve) => {
          finish = resolve;
        }),
    );
    const pendingArgs = writeArgs(adapter, {
      xMm: 1,
      yMm: 1,
      widthMm: 20,
      fontSizeMm: 10,
      text: 'Held write',
    });
    const pending = adapter.execute('add_text', pendingArgs);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const revision = adapter.getRevision();
    expect(
      resultCode(await adapter.execute('set_selection', writeArgs(adapter, { artworkIds: [] }))),
    ).toBe('failed');
    expect(adapter.getRevision()).toBe(revision);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    finish({
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 5 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 5 },
              ],
            },
          ],
        },
      ],
    });
    const committed = await pending;
    expect(resultCode(committed)).toBe('ok');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(await adapter.execute('add_text', pendingArgs)).toEqual(committed);
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });

  it.each(['permission', 'document', 'controller', 'renderer'] as const)(
    'cannot revive the waiting review when its %s owner is replaced during renewal',
    async (owner) => {
      await fillWindow(256);
      const args = writeArgs(adapter);
      await adapter.execute('review_machine_job', args);
      const first = await reviewing(args.requestId);
      let armed = true;
      const unsubscribe = useJobReviewStore.subscribe((state) => {
        if (!armed || state.state.kind !== 'open' || !state.state.isPreparing) return;
        armed = false;
        if (owner === 'permission') controller.abort();
        if (owner === 'document') useStore.getState().newProject();
        if (owner === 'controller')
          useLaserStore.setState((laser) => ({
            controllerSessionEpoch: laser.controllerSessionEpoch + 1,
          }));
        if (owner === 'renderer') adapter.dispose();
      });
      try {
        expect(
          resultCode(
            await adapter.execute('set_selection', writeArgs(adapter, { artworkIds: [] })),
          ),
        ).toBe('stale_revision');
        await vi.waitFor(() => expect(armed).toBe(false));
        await vi.waitFor(() => expect(useJobReviewStore.getState().state.kind).toBe('idle'));
        expect(
          (
            await adapter.execute(
              'start_job',
              writeArgs(adapter, { reviewId: first.review!.reviewId }),
            )
          ).ok,
        ).toBe(false);
        expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
        if (owner === 'document') expect(useStore.getState().project.scene.objects).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    },
    15_000,
  );
});
