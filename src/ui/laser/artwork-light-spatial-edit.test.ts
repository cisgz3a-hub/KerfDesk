import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { FakeSerialPort } from '../../__fixtures__/controllers';
import type { Layer } from '../../core/scene';
import { GRBL_SETTLE_DWELL } from '../../core/controllers';
import { framedRunStartHandoffIssue } from '../state/framed-run';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { centreLightOnFramedArtwork, centreSelectionLight } from './centre-selection-light';
import {
  connectedFixture,
  expectProgramSentOnce,
  startReviewedFrameOnClock,
} from './frame-artwork-centre-led.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { prepareFramedStartReview } from './framed-start-preparation';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
});
afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function frame() {
  const pending = runFrameNow();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
  const permit = useLaserStore.getState().framedRun;
  expect(permit).not.toBeNull();
  return permit!;
}

/** Delay only the post-jog settlement ACK. Firmware motion, fresh status and
 * every production Frame/LED ownership check continue through the real store. */
function holdLedSettlement(port: FakeSerialPort) {
  const emit = port.emitLine;
  let moved = false;
  let armed = false;
  let held: string | null = null;
  const stop = port.onWrite((payload) => {
    if (payload.includes('$J=')) moved = true;
    if (moved && payload.trim() === GRBL_SETTLE_DWELL) armed = true;
  });
  const spy = vi.spyOn(port, 'emitLine').mockImplementation((line) => {
    if (armed && /^ok\b/.test(line)) {
      armed = false;
      held = line;
    } else emit(line);
  });
  return {
    held: () => held !== null,
    release: () => {
      const line = held;
      held = null;
      if (line !== null) emit(line);
    },
    dispose: () => {
      stop();
      spy.mockRestore();
    },
  };
}

const actions = [
  { kind: 'manual', run: () => centreSelectionLight(['selected']) },
  { kind: 'automatic', run: centreLightOnFramedArtwork },
] as const;
const processEdits: ReadonlyArray<{ name: string; patch: Partial<Layer> }> = [
  { name: 'power', patch: { power: 37 } },
  { name: 'speed', patch: { speed: 1350 } },
  { name: 'layer name', patch: { name: 'Renamed cutting operation' } },
];

function moveArtworkThenUndo(): void {
  const initial = useStore.getState().project;
  const artwork = initial.scene.objects.find((object) => object.id === 'selected')!;
  useStore.getState().beginInteraction();
  useStore.getState().setObjectTransform(artwork.id, {
    ...artwork.transform,
    x: artwork.transform.x + 10,
  });
  useStore.getState().endInteraction();
  expect(useStore.getState().project).not.toBe(initial);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(initial);
}

describe('spatial Frame identity through actual artwork LED travel', () => {
  it.each(actions.flatMap((action) => processEdits.map((edit) => ({ ...action, ...edit }))))(
    '$kind retains captured placement and Start after a $name edit during LED settlement',
    async ({ run, patch }) => {
      const { sim } = await connectedFixture('grbl-v1.1', 'current-position');
      const before = await frame();
      const spatial = currentFrameSpatialSignature();
      const ack = holdLedSettlement(sim.port);
      const pending = run().then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(ack.held()).toBe(true);
      expect(useLaserStore.getState().completedFrame).toBeNull();
      useStore.getState().setLayerParam('output', patch);
      expect(currentFrameSpatialSignature()).toBe(spatial);
      ack.release();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBeNull();
      ack.dispose();
      const laser = useLaserStore.getState();
      expect(laser.positioningLightEnabled).toBe(true);
      expect(laser.framedRun?.candidate).toBe(before.candidate);
      expect(framedRunStartHandoffIssue(laser.framedRun!, laser)).toBeNull();
      const review = await prepareFramedStartReview(laser.framedRun!);
      expect(review).not.toBeNull();
      expect(
        review!.prepared.prepared.project.scene.layers.find((layer) => layer.id === 'output'),
      ).toMatchObject(patch);
      if (patch.power !== undefined) expect(review!.prepared.gcode).toMatch(/S370(?:\s|$)/);
      if (patch.speed !== undefined) expect(review!.prepared.gcode).toContain('F1350');
      expect(review!.prepared.jobOrigin).toEqual(before.candidate.preparedStart.jobOrigin);
      expect(review!.prepared.metrics.frameJobBounds).toEqual(
        before.candidate.preparedStart.metrics.frameJobBounds,
      );
      const firstWrite = sim.outbound().length;
      const repository = await startReviewedFrameOnClock();
      expectProgramSentOnce(sim.outbound().slice(firstWrite), review!.prepared.gcode);
      const archive = repository.getSnapshot();
      expect((archive.lastCompletedReceipt ?? archive.activeRun)?.artifact.jobOrigin).toMatchObject(
        {
          startFrom: 'current-position',
          currentPosition: { x: 75, y: 45 },
        },
      );
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
  );

  it.each(actions)(
    '$kind does not resurrect Frame after geometric edit and Undo during LED settlement',
    async ({ run }) => {
      const { sim } = await connectedFixture('grbl-v1.1', 'current-position');
      await frame();
      const spatial = currentFrameSpatialSignature();
      const firstWrite = sim.outbound().length;
      const ack = holdLedSettlement(sim.port);
      const pending = run().then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(ack.held()).toBe(true);
      moveArtworkThenUndo();
      expect(currentFrameSpatialSignature()).toBe(spatial);
      ack.release();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toMatchObject({ message: expect.stringMatching(/changed|cancelled/i) });
      ack.dispose();
      const laser = useLaserStore.getState();
      expect(laser.positioningLightEnabled).toBe(false);
      expect(laser.framedRun).toBeNull();
      expect(laser.completedFrame).toBeNull();
      expect(sim.outbound().slice(firstWrite).join('')).not.toContain('M7\n');
    },
  );
});
