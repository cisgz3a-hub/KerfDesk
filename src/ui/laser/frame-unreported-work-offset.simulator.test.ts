// Regression (ADR-375): a Frame pressed before GRBL had sent its work-coordinate
// offset placed an Absolute job at an assumed zero offset. GRBL sends WCO only
// when its refresh counter comes round (every 10th Idle, 30th busy report), in
// the report after an offset changes, and in the first report after a reset, so
// a board that does not reset when the port opens can keep a stored G54 offset
// out of up to ten reports. The trace's `$J=G90` targets are work
// coordinates, so the head traced the job shifted by that offset, and the offset
// reported during the trace then voided the Frame. Frame now asks for the offset
// first; when none comes it frames at the assumed zero and Job Review says so.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L561-L568
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L603-L611
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/jogging.md#L23

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { runFrameNow } from './use-frame-action';
import { WORK_OFFSET_ASSUMED_ZERO_WARNING } from './work-offset-assumption';
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

const G54_OFFSET = { x: 150, y: 100 };
const WCO_FIELD = /\|WCO:[^|>]*/;
type Point = { readonly x: number; readonly y: number };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
});
afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

/** The simulator prints WCO in every report. Keep it only where GRBL's refresh
 * counter would: after `reportsWithoutWco` more reports, then every 10th Idle
 * (30th busy) report, and in the next report after G10, G92 or a reset. */
function withGrblWcoRefresh(sim: GrblSimulator, reportsWithoutWco: number): PlatformAdapter {
  let counter = reportsWithoutWco;
  const refresh = (line: string): string => {
    if (!line.startsWith('<') || !WCO_FIELD.test(line)) return line;
    if (counter > 0) {
      counter -= 1;
      return line.replace(WCO_FIELD, '');
    }
    counter = (/^<(Idle|Alarm|Check|Sleep)/.test(line) ? 10 : 30) - 1;
    return line;
  };
  const connection = (inner: SerialConnection): SerialConnection => ({
    ...inner,
    write: async (data) => {
      if (/\bG(10|92)\b/.test(data) || data.includes('\x18')) counter = 0;
      await inner.write(data);
    },
    onLine: (handler) => inner.onLine((line) => handler(refresh(line))),
  });
  return {
    ...sim.adapter,
    serial: {
      ...sim.adapter.serial,
      requestPort: async () => {
        const port = await sim.adapter.serial.requestPort();
        if (port === null) return null;
        return { ...port, open: async (request) => connection(await port.open(request)) };
      },
    },
  };
}

function lineProject(): Project {
  const base = createProject();
  return {
    ...base,
    // Never homed, so the Frame's existing post-Home offset wait never applies.
    device: { ...base.device, homing: { ...base.device.homing, enabled: false } },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), power: 10 }],
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
}

/** Connect to a board that was not reset when the port opened: no banner, a
 * stored G54 offset, and WCO withheld from the next `reportsWithoutWco`. */
async function connectMidRefresh(g54: Point, reportsWithoutWco: number): Promise<GrblSimulator> {
  const project = lineProject();
  useStore.setState({ project, jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
  const sim = createGrblSimulator({
    motionMs: 25,
    emitBannerOnOpen: false,
    settings: [
      [22, '0'],
      [32, '1'],
    ],
  });
  await sim.port.connection.write(`G10 L2 P1 X${g54.x} Y${g54.y}\n`);
  await useLaserStore
    .getState()
    .connect(withGrblWcoRefresh(sim, reportsWithoutWco), connectOptionsForDevice(project.device));
  await vi.advanceTimersByTimeAsync(1_500);
  return sim;
}

type FrameRun = {
  readonly ok: boolean;
  readonly jogs: ReadonlyArray<Point>;
  /** From the press to the Frame's first motion line. */
  readonly msBeforeMotion: number;
};

async function frame(sim: GrblSimulator): Promise<FrameRun> {
  const pressedAt = Date.now();
  let firstMotionAt: number | null = null;
  const jogs: Point[] = [];
  const stopWatching = sim.port.onWrite((data) => {
    for (const target of data.matchAll(/^\$J=G90 G21 X(-?[\d.]+) Y(-?[\d.]+)/gm)) {
      firstMotionAt ??= Date.now();
      jogs.push({ x: Number(target[1]), y: Number(target[2]) });
    }
  });
  const framing = runFrameNow();
  await vi.advanceTimersByTimeAsync(12_000);
  const ok = await framing;
  stopWatching();
  return { ok, jogs, msBeforeMotion: (firstMotionAt ?? Number.NaN) - pressedAt };
}

/** The work-coordinate trace with no offset anywhere: the drawn position. */
async function drawnTrace(): Promise<ReadonlyArray<Point>> {
  const sim = await connectMidRefresh({ x: 0, y: 0 }, 0);
  const { ok, jogs } = await frame(sim);
  expect(ok).toBe(true);
  const disconnecting = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(2_000);
  await disconnecting;
  useLaserStore.setState(initialLaserState());
  return jogs;
}

describe('Frame before the controller has reported its work offset', () => {
  it('asks for the stored G54 offset and traces the job where it is drawn', async () => {
    const drawn = await drawnTrace();
    const sim = await connectMidRefresh(G54_OFFSET, 9);
    expect(useLaserStore.getState()).toMatchObject({ wcoCache: null, homingState: 'unknown' });

    const { ok, jogs, msBeforeMotion } = await frame(sim);

    // The withheld reports go by at one `?` per 100 ms, then WCO arrives.
    expect(msBeforeMotion).toBeLessThan(2_000);
    // Absolute compensates the reported offset, so the work-coordinate targets
    // move by it and the head passes over the drawn bed position.
    expect(jogs).toEqual(drawn.map((p) => ({ x: p.x - G54_OFFSET.x, y: p.y - G54_OFFSET.y })));
    expect(ok).toBe(true);
    expect(useLaserStore.getState().wcoCache).toEqual({ ...G54_OFFSET, z: 0 });
    const permit = useLaserStore.getState().framedRun;
    expect(permit).not.toBeNull();
    expect(permit?.candidate.preparedStart.warnings).not.toContain(
      WORK_OFFSET_ASSUMED_ZERO_WARNING,
    );
  });

  it('frames at the assumed zero after a bounded wait, and says so, when no WCO comes', async () => {
    const drawn = await drawnTrace();
    // A build without the WCO field reports none at all (interface.md#L565-L567).
    const sim = await connectMidRefresh({ x: 0, y: 0 }, Number.POSITIVE_INFINITY);

    const { ok, jogs, msBeforeMotion } = await frame(sim);

    // No new refusal: three seconds of `?` every 100 ms, then the ordinary
    // Frame at the assumed zero, which Job Review names.
    expect(msBeforeMotion).toBeGreaterThanOrEqual(3_000);
    expect(msBeforeMotion).toBeLessThan(4_000);
    expect(ok).toBe(true);
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(jogs).toEqual(drawn);
    expect(useLaserStore.getState().framedRun?.candidate.preparedStart.warnings).toContain(
      WORK_OFFSET_ASSUMED_ZERO_WARNING,
    );
  });
});
