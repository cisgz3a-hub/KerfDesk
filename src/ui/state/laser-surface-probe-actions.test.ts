import { afterEach, expect, it } from 'vitest';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { useStore } from './store';
import { flushConnect } from './laser-store-console-harness';
import { surfaceSimulator } from './surface-probe.simulator.test-support';
import type { SurfaceGridRequest } from '../../core/controllers/grbl/surface-grid-probe';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';

const ORIGINAL_PROJECT = useStore.getState().project;
const REQUEST: SurfaceGridRequest = {
  minX: 0,
  minY: 0,
  maxX: 10,
  maxY: 10,
  columns: 2,
  rows: 2,
  seekFeed: 150,
  probeFeed: 25,
  travelFeed: 500,
  maxTravelMm: 10,
  clearancePrepared: true,
};
afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: ORIGINAL_PROJECT });
});

it.each([false, true])(
  'collects the owned grid with correct mm coordinates (report inches=%s) and never writes work offsets',
  async (inches) => {
    const { connection, writes } = await surfaceSimulator({ inches });
    const measuring = useLaserStore.getState().measureSurfaceGrid(REQUEST);
    await flushConnect();
    // An ok is insufficient; final settlement remains owned until two later Idle reports.
    for (let i = 0; i < 30; i += 1) await flushConnect();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'awaiting-idle',
    });
    expect(useLaserStore.getState().probeBusy).toBe(true);
    connection.emitLine(
      `<Idle|MPos:${100 / (inches ? 25.4 : 1)},${210 / (inches ? 25.4 : 1)},${5 / (inches ? 25.4 : 1)}|FS:0,0>`,
    );
    connection.emitLine(
      `<Idle|MPos:${100 / (inches ? 25.4 : 1)},${210 / (inches ? 25.4 : 1)},${5 / (inches ? 25.4 : 1)}|FS:0,0>`,
    );
    const result = await measuring;
    expect(result.kind).toBe('ok');
    expect(result.measurement?.points.map((p) => [p.x, p.y, Number(p.z.toFixed(4))])).toEqual([
      [0, 0, 0],
      [10, 0, 0.1],
      [10, 10, 0.15],
      [0, 10, 0.05],
    ]);
    expect(result.measurement?.offsetMm).toEqual({ x: 100, y: 200, z: -5 });
    expect(writes.filter((line) => /G10|G92|\$13=|G54\n/.test(line))).toEqual([]);
    expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(8);
    expect(useLaserStore.getState().probeBusy).toBe(false);
  },
);

it('rejects rotated coordinates before tool-off or motion and releases the read-only reservation', async () => {
  const { writes } = await surfaceSimulator({ rotate: true });
  const result = await useLaserStore.getState().measureSurfaceGrid(REQUEST);
  expect(result).toMatchObject({ kind: 'failed', reason: expect.stringContaining('Rotated') });
  expect(writes).toEqual(['$G\n', '$#\n']);
  expect(useLaserStore.getState().controllerOperation).toBeNull();
});

it('stops collection on a probe alarm and retains an explicitly partial review', async () => {
  const { writes } = await surfaceSimulator({ failContact: true });
  const result = await useLaserStore.getState().measureSurfaceGrid(REQUEST);
  expect(result).toMatchObject({ kind: 'failed', measurement: { complete: false, points: [] } });
  expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(1);
  expect(useLaserStore.getState().probeBusy).toBe(false);
});

it('does not start a motion transaction without current-session report-unit evidence', async () => {
  const { writes } = await surfaceSimulator();
  useLaserStore.setState({ controllerSettingsObservation: null });
  const result = await useLaserStore.getState().measureSurfaceGrid(REQUEST);
  expect(result).toMatchObject({
    kind: 'failed',
    reason: expect.stringContaining('current-session'),
  });
  expect(writes).toEqual([]);
});

it.each(['abort', 'disconnect'] as const)(
  'ends collection after %s without another probe contact or offset write',
  async (action) => {
    const { writes } = await surfaceSimulator({ pauseFirstContact: true });
    const measuring = useLaserStore.getState().measureSurfaceGrid(REQUEST);
    for (let i = 0; i < 10; i += 1) await flushConnect();
    expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(1);
    if (action === 'abort') await useLaserStore.getState().stopJob();
    else await useLaserStore.getState().disconnect();
    const result = await measuring;
    expect(result).toMatchObject({ kind: 'failed', measurement: { complete: false, points: [] } });
    expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(1);
    expect(writes.filter((line) => /G10|G92/.test(line))).toEqual([]);
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    if (action === 'abort') expect(writes).toContain('\x18');
  },
);

it('retains completed spatial Frame proof while discarding its consumable run permit', async () => {
  installFrameOnceProject();
  const { connection } = await surfaceSimulator();
  const permit = await installReviewPendingFramedRunPermitForCurrentState();
  const measuring = useLaserStore.getState().measureSurfaceGrid(REQUEST);
  for (let i = 0; i < 30; i += 1) await flushConnect();
  expect(useLaserStore.getState().framedRun).toBeNull();
  expect(useLaserStore.getState().completedFrame).toBe(permit);
  connection.emitLine('<Idle|MPos:100,210,5|FS:0,0>');
  connection.emitLine('<Idle|MPos:100,210,5|FS:0,0>');
  expect((await measuring).kind).toBe('ok');
  expect(useLaserStore.getState().completedFrame).toBe(permit);
});
