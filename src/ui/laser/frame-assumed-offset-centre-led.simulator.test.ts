import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { connectOptionsForDevice } from '../commands/connect-options';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { framedRunStartHandoffIssue } from '../state/framed-run';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { centreSelectionLight } from './centre-selection-light';
import {
  expectProgramSentOnce,
  startReviewedFrameOnClock,
} from './frame-artwork-centre-led.test-support';
import { prepareFramedStartReview } from './framed-start-preparation';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { centreLightAfterCleanFrame, runFrameNow } from './use-frame-action';
import { WORK_OFFSET_ASSUMED_ZERO_WARNING } from './work-offset-assumption';

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

async function fixture(report: 'machine' | 'work', mode: 'absolute' | 'current-position') {
  const base = createProject();
  const project = {
    ...base,
    device: {
      ...base.device,
      origin: 'front-left' as const,
      homing: { ...base.device.homing, enabled: false },
      positioningLight: {
        onCommand: 'M7',
        offCommand: 'M9',
        offsetXmm: 7,
        offsetYmm: -4,
        afterFrame: true,
      },
    },
    scene: {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: 'line', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'artwork',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 30, minY: 40, maxX: 50, maxY: 50 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 30, y: 40 },
                    { x: 50, y: 50 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  useStore.setState({
    project,
    selectedObjectId: 'artwork',
    jobPlacement: { startFrom: mode, anchor: 'front-left' },
  });
  const sim = createGrblSimulator({
    motionMs: 25,
    settings: [
      [22, '0'],
      [32, '1'],
    ],
  });
  // Work-only reports can retain a genuinely nonzero, unreported G54. The
  // machine-only case exercises Frame's existing assumed-zero contract.
  const offset = report === 'work' ? { x: 150, y: 100 } : { x: 0, y: 0 };
  await sim.port.connection.write(`G10 L2 P1 X${offset.x} Y${offset.y}\nG90\nG0 X75 Y45\n`);
  await vi.advanceTimersByTimeAsync(100);
  const decorate = (inner: SerialConnection): SerialConnection => ({
    ...inner,
    onLine: (handler) =>
      inner.onLine((line) => {
        if (!line.startsWith('<')) return handler(line);
        let filtered = line.replace(/\|WCO:[^|>]*/, '');
        if (report === 'work')
          filtered = filtered.replace(
            /\|MPos:([^,]+),([^,]+),([^|>]+)/,
            (_match, x: string, y: string, z: string) =>
              `|WPos:${Number(x) - offset.x},${Number(y) - offset.y},${z}`,
          );
        handler(filtered);
      }),
  });
  const adapter: PlatformAdapter = {
    ...sim.adapter,
    serial: {
      ...sim.adapter.serial,
      requestPort: async () => {
        const port = await sim.adapter.serial.requestPort();
        return port === null
          ? null
          : { ...port, open: async (options) => decorate(await port.open(options)) };
      },
    },
  };
  await useLaserStore.getState().connect(adapter, connectOptionsForDevice(project.device));
  await vi.advanceTimersByTimeAsync(1_500);
  expect(useLaserStore.getState().wcoCache).toBeNull();
  expect(useLaserStore.getState().workOriginActive).toBe(false);
  return { sim, project, offset };
}

const cases = (['machine', 'work'] as const).flatMap((report) =>
  (['absolute', 'current-position'] as const).flatMap((mode) =>
    (['automatic', 'selected'] as const).map((action) => ({ report, mode, action })),
  ),
);

describe('positioning LED after a Frame with an unreported work offset', () => {
  it.each(cases)(
    '$report report / $mode / $action retains the traced centre and Start placement',
    async ({ report, mode, action }) => {
      const { sim, project, offset } = await fixture(report, mode);
      const framing = runFrameNow();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(await framing, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
      const before = useLaserStore.getState().framedRun!;
      expect(before).not.toBeNull();
      expect(before.candidate.preparedStart.warnings).toContain(WORK_OFFSET_ASSUMED_ZERO_WARNING);
      const centring =
        action === 'automatic'
          ? centreLightAfterCleanFrame(true)
          : centreSelectionLight(['artwork']);
      const result = centring.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await result, JSON.stringify(useToastStore.getState().toasts)).toBeNull();
      const centre =
        mode === 'absolute' ? { x: 40, y: project.device.bedHeight - 45 } : { x: 85, y: 50 };
      // Inspect the real simulator report independently of the filtered app feed.
      const raw: string[] = [];
      const stop = sim.port.connection.onLine((line) => raw.push(line));
      await sim.port.connection.write('?');
      await vi.advanceTimersByTimeAsync(50);
      stop();
      const native = raw.join('').match(/MPos:([^,]+),([^,]+),/);
      expect(native).not.toBeNull();
      expect(Number(native![1])).toBeCloseTo(centre.x + offset.x - 7, 3);
      expect(Number(native![2])).toBeCloseTo(centre.y + offset.y - 4, 3);
      await vi.advanceTimersByTimeAsync(20_000);
      const after = useLaserStore.getState();
      expect(after.wcoCache).toBeNull();
      expect(after.positioningLightEnabled).toBe(true);
      expect(after.framedRun?.candidate).toBe(before.candidate);
      expect(framedRunStartHandoffIssue(after.framedRun!, after)).toBeNull();
      const reviewed = await prepareFramedStartReview(after.framedRun!);
      expect(reviewed).not.toBeNull();
      expect(reviewed?.prepared.jobOrigin).toEqual(before.candidate.preparedStart.jobOrigin);
      expect(reviewed?.prepared.metrics.frameJobBounds).toEqual(
        before.candidate.preparedStart.metrics.frameJobBounds,
      );
      expect(reviewed?.prepared.metrics.frameMotionBounds).toEqual(
        before.candidate.preparedStart.metrics.frameMotionBounds,
      );
      expect(reviewed?.prepared.warnings).toContain(WORK_OFFSET_ASSUMED_ZERO_WARNING);
      if (mode === 'current-position')
        expect(reviewed?.prepared.jobOrigin).toMatchObject({ currentPosition: { x: 75, y: 45 } });
      const from = sim.outbound().length;
      await startReviewedFrameOnClock();
      expectProgramSentOnce(sim.outbound().slice(from), reviewed!.prepared.gcode);
    },
  );
});
