// Regression (rolling audit v9 R8-P1-1): a Frame pressed within about a second
// of an origin write took its placement and return point from the status
// report read before the write. With MPos and the old WCO, the head returned
// to machine (200, 160) instead of (100, 80), beam off, and Frame refused
// afterwards. With `$10=0` the stale WPos passed every check, a permit was
// issued, and a Current Position job burned 100 x 80 mm from the head.
//
// The origin write now records the status sequence at its acknowledgement and
// keeps only the stale report's MPos; Frame waits for a report sent after the
// write and refuses, before any motion, if none comes. The simulator's reports
// are held back after the write to open that window every time, and reshaped
// to model stock GRBL's WCO cadence, `$10=0` and `$10=2`
// (frame-after-origin-write.test-support.ts). Real store, real Frame and
// Start, real compile; no hardware.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type createGrblSimulator,
  createMarlinSimulator,
  createSmoothieSimulator,
} from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import type { JobPlacementSettings } from '../../core/job';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { statusPredatesOriginChange } from '../state/origin-status-fence';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { clearFrameExpiryNote } from './frame-expiry-note';
import {
  connectAtHead,
  HEAD,
  lineProject,
  type shapedReports,
  type Machine,
  type ReportShape,
} from './frame-after-origin-write.test-support';
import { createProject } from '../../core/scene';
import { startReviewedFrameOnClock } from './frame-artwork-centre-led.test-support';
import { FRAME_STATUS_AFTER_ORIGIN_MESSAGE } from './frame-position-readiness';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { useStartBlockerStore } from './start-blocker-store';
import { runFrameNow } from './use-frame-action';
import type * as OutputPreparationWorker from './output-preparation-worker-client';

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

const USER_ORIGIN: JobPlacementSettings = { startFrom: 'user-origin', anchor: 'front-left' };
const CURRENT_POSITION: JobPlacementSettings = {
  startFrom: 'current-position',
  anchor: 'front-left',
};
// Long enough for any wait to give up if it were going to; the simulator's
// reports stay held for this long after the origin write.
const STALE_WINDOW_MS = 400;

let disposeReview: () => void = () => undefined;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  clearFrameExpiryNote();
  disposeReview = installAutoJobReview('confirm');
});
afterEach(async () => {
  disposeReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

/** Writes the origin with every status report held back, starts the Frame the
 * moment the write resolves, and lets reports through again afterwards. */
async function frameRightAfter(
  reports: ReturnType<typeof shapedReports>,
  writeOrigin: () => Promise<void>,
  holdMs = STALE_WINDOW_MS,
): Promise<{ readonly framed: boolean; readonly staleAtFrame: boolean }> {
  reports.hold();
  let staleAtFrame = false;
  const framing = writeOrigin().then(() => {
    staleAtFrame = statusPredatesOriginChange(useLaserStore.getState());
    return runFrameNow();
  });
  await vi.advanceTimersByTimeAsync(holdMs);
  reports.release();
  await vi.advanceTimersByTimeAsync(15_000);
  return { framed: await framing, staleAtFrame };
}

function expectHeadAt(sim: ReturnType<typeof createGrblSimulator>, x: number, y: number): void {
  expect(sim.state().mpos.x).toBeCloseTo(x, 3);
  expect(sim.state().mpos.y).toBeCloseTo(y, 3);
}

describe('Frame right after an origin write (R8-P1-1)', () => {
  it.each<[Machine, ReportShape]>([
    ['grbl', 'every-report'],
    ['grbl', 'stock-cadence'],
    ['grbl', 'wpos'],
    ['grbl', 'wpos-buffer'],
    ['falcon-a1-pro', 'every-report'],
    ['falcon-a1-pro', 'stock-cadence'],
  ])('Set origin: %s, %s reports, returns the head to where it was set', async (machine, shape) => {
    const { sim, reports } = await connectAtHead(machine, shape, USER_ORIGIN);

    const { framed, staleAtFrame } = await frameRightAfter(reports, () =>
      useLaserStore.getState().setOriginHere(),
    );

    // The window was open: the report on hand predated the G92.
    expect(staleAtFrame).toBe(true);
    expect(framed).toBe(true);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expectHeadAt(sim, HEAD.x, HEAD.y);
    // The trace ran in the new origin: X0..20 work is machine 100..120.
    const sent = sim.outbound().join('');
    expect(sent).toMatch(machine === 'falcon-a1-pro' ? /G1 X20\.000/ : /\$J=G90 G21 X20\.000/);
  });

  it('Reset origin: the trace and the return use machine coordinates, not the old offset', async () => {
    const { sim, reports } = await connectAtHead('grbl', 'every-report', CURRENT_POSITION);
    const setting = useLaserStore.getState().setOriginHere();
    await vi.advanceTimersByTimeAsync(2_000);
    await setting;

    const { framed, staleAtFrame } = await frameRightAfter(reports, () =>
      useLaserStore.getState().resetOrigin(),
    );

    expect(staleAtFrame).toBe(true);
    expect(framed).toBe(true);
    expectHeadAt(sim, HEAD.x, HEAD.y);
    expect(sim.outbound().join('')).toMatch(/\$J=G90 G21 X120\.000/);
  });

  it('Restore origin: the Frame returns to the head', async () => {
    const { sim, reports } = await connectAtHead('grbl', 'stock-cadence', USER_ORIGIN);

    const { framed } = await frameRightAfter(reports, () =>
      useLaserStore.getState().restoreWorkOrigin({ x: 50, y: 30 }),
    );

    expect(framed).toBe(true);
    expectHeadAt(sim, HEAD.x, HEAD.y);
    // Work X0 is machine 50: the trace's far corner X20 work is machine 70.
    expect(sim.outbound().join('')).toMatch(/\$J=G90 G21 X20\.000/);
  });

  it('refuses before any motion when no report follows the origin write', async () => {
    const { sim, reports } = await connectAtHead('grbl', 'every-report', USER_ORIGIN);
    const beforeFrame = sim.outbound().length;

    const { framed } = await frameRightAfter(
      reports,
      () => useLaserStore.getState().setOriginHere(),
      10_000,
    );

    expect(framed).toBe(false);
    expect(useStartBlockerStore.getState().messages).toContain(FRAME_STATUS_AFTER_ORIGIN_MESSAGE);
    const afterOrigin = sim.outbound().slice(beforeFrame).join('');
    expect(afterOrigin).not.toMatch(/\$J=|G1 X/);
    expectHeadAt(sim, HEAD.x, HEAD.y);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('$10=0 Current Position: Start burns at the head, not the old offset away', async () => {
    const { sim, reports } = await connectAtHead('grbl', 'wpos', CURRENT_POSITION);

    const { framed } = await frameRightAfter(reports, () =>
      useLaserStore.getState().setOriginHere(),
    );
    expect(framed).toBe(true);
    const beforeStart = sim.outbound().length;
    await startReviewedFrameOnClock();

    const burns = sim
      .outbound()
      .slice(beforeStart)
      .filter((payload) => payload !== '?')
      .join('')
      .split('\n')
      .filter((line) => /^G1 .*X-?\d/.test(line));
    expect(burns.length).toBeGreaterThan(0);
    // The job sits at the head: work X0..20, Y0..10. A stale WPos put it at
    // X100..120, Y80..90.
    for (const line of burns) {
      const x = Number(/X(-?[\d.]+)/.exec(line)?.[1]);
      expect(x).toBeGreaterThanOrEqual(-0.001);
      expect(x).toBeLessThanOrEqual(20.001);
    }
  });
});

describe('the other motion routes right after an origin write (R8-P1-1)', () => {
  it.each<ReportShape>(['every-report', 'wpos'])(
    'Move laser here (jog to a machine point) lands on that point: %s reports',
    async (shape) => {
      const { sim, reports } = await connectAtHead('grbl', shape, USER_ORIGIN);
      reports.hold();
      const moving = useLaserStore
        .getState()
        .setOriginHere()
        .then(() => useLaserStore.getState().jogToMachinePosition(150, 100, 1000));
      await vi.advanceTimersByTimeAsync(STALE_WINDOW_MS);
      reports.release();
      await vi.advanceTimersByTimeAsync(5_000);
      await moving;
      expectHeadAt(sim, 150, 100);
    },
  );

  it.each<ReportShape>(['every-report', 'wpos'])(
    'a jog moves by its distance: %s reports',
    async (shape) => {
      const { sim, reports } = await connectAtHead('grbl', shape, USER_ORIGIN);
      reports.hold();
      const jogging = useLaserStore
        .getState()
        .setOriginHere()
        .then(() => useLaserStore.getState().jog({ dx: 10, dy: 5, feed: 1000 }));
      await vi.advanceTimersByTimeAsync(STALE_WINDOW_MS);
      reports.release();
      await vi.advanceTimersByTimeAsync(5_000);
      await jogging;
      expectHeadAt(sim, HEAD.x + 10, HEAD.y + 5);
    },
  );

  it('Place Board (an origin at a machine point) frames from that origin and returns', async () => {
    const { sim, reports } = await connectAtHead('grbl', 'stock-cadence', USER_ORIGIN);

    const { framed } = await frameRightAfter(reports, () =>
      useLaserStore.getState().setOriginAtMachinePoint({ x: 60, y: 40 }),
    );

    expect(framed).toBe(true);
    expectHeadAt(sim, HEAD.x, HEAD.y);
  });
});

describe('Marlin and Smoothieware right after Set origin (controls)', () => {
  it.each(['marlin', 'smoothieware'] as const)(
    '%s: Frame returns to the work zero it just set',
    async (kind) => {
      const base = createProject().device;
      const project = lineProject({
        ...base,
        controllerKind: kind,
        ...(kind === 'marlin' ? { gcodeDialect: { dialectId: 'marlin-inline' as const } } : {}),
        maxPowerS: kind === 'smoothieware' ? 1 : 1000,
      });
      useStore.setState({ project, jobPlacement: USER_ORIGIN });
      const sim =
        kind === 'marlin'
          ? createMarlinSimulator({ motionMs: 25 })
          : createSmoothieSimulator({ motionMs: 25 });
      await useLaserStore.getState().connect(sim.adapter, connectOptionsForDevice(project.device));
      await vi.advanceTimersByTimeAsync(2_000);
      const jogging = useLaserStore.getState().jog({ dx: HEAD.x, dy: HEAD.y, feed: 1000 });
      await vi.advanceTimersByTimeAsync(3_000);
      await jogging;

      const framing = useLaserStore
        .getState()
        .setOriginHere()
        .then(() => runFrameNow());
      await vi.advanceTimersByTimeAsync(20_000);

      expect(await framing).toBe(true);
      const moves = sim
        .outbound()
        .filter((payload) => payload !== '?')
        .join('')
        .split('\n')
        .filter((line) => /^G[01] .*X-?[\d.]+ Y-?[\d.]+/.test(line));
      // The last move is the return to the head, at work zero.
      expect(moves.at(-1)).toMatch(/X0(\.0+)? Y0(\.0+)?\b/);
    },
  );
});
