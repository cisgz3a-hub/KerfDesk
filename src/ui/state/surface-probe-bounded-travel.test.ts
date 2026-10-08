import { afterEach, expect, it, vi } from 'vitest';
import type { SurfaceGridRequest } from '../../core/controllers/grbl/surface-grid-probe';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { flushConnect } from './laser-store-console-harness';
import { surfaceSimulator } from './surface-probe.simulator.test-support';
import { useStore } from './store';

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
  maxTravelMm: 1,
  clearancePrepared: true,
};
afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: ORIGINAL_PROJECT });
});

/** Independent emitted-command endpoint walk. Successful probes stop at the fixture's contact. */
function zEndpoints(writes: ReadonlyArray<string>, contactZ: number): ReadonlyArray<number> {
  let currentZ = 10;
  const endpoints: number[] = [];
  for (const line of writes) {
    const move = /^G(90|91) (G1|G38\.2) Z(-?[\d.]+)/.exec(line);
    if (move === null) continue;
    const endpoint = move[1] === '90' ? Number(move[3]) : currentZ + Number(move[3]);
    endpoints.push(endpoint);
    currentZ = move[2] === 'G38.2' ? contactZ : endpoint;
  }
  return endpoints;
}

it.each([9, 9.99])(
  'keeps all Z endpoints within the prepared plane and 1mm floor when fast contact is %s',
  async (contactWorkZ) => {
    const { connection, writes } = await surfaceSimulator({ contactWorkZ });
    const measuring = useLaserStore.getState().measureSurfaceGrid(REQUEST);
    for (let i = 0; i < 30; i += 1) await flushConnect();
    connection.emitLine('<Idle|MPos:100,210,5|FS:0,0>');
    connection.emitLine('<Idle|MPos:100,210,5|FS:0,0>');
    const result = await measuring;
    expect(result.kind).toBe('ok');
    expect(result.measurement?.points).toHaveLength(4);
    expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(8);
    const endpoints = zEndpoints(writes, contactWorkZ);
    expect(endpoints.length).toBeGreaterThanOrEqual(16);
    expect(Math.min(...endpoints)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...endpoints)).toBeLessThanOrEqual(10);
  },
);

it('stops at a failed slow contact without moving to another grid point', async () => {
  const { writes } = await surfaceSimulator({ contactWorkZ: 9, failContactAt: 2 });
  const result = await useLaserStore.getState().measureSurfaceGrid(REQUEST);
  expect(result).toMatchObject({ kind: 'failed', measurement: { complete: false, points: [] } });
  expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(2);
  expect(writes.filter((line) => /^G90 G1 X/.test(line))).toHaveLength(1);
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  expect(useLaserStore.getState().probeBusy).toBe(false);
});

it('contains Abort during the slow contact without writing another contact or offset', async () => {
  const { connection, writes } = await surfaceSimulator({ contactWorkZ: 9.99, pauseContactAt: 2 });
  const measuring = useLaserStore.getState().measureSurfaceGrid(REQUEST);
  for (let i = 0; i < 10; i += 1) await flushConnect();
  expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(2);

  const originalWrite = connection.write.bind(connection);
  let finishCleanup = (): void => undefined;
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  const write = vi.spyOn(connection, 'write').mockImplementation(async (data) => {
    await originalWrite(data);
    // The controller acknowledges M9 before its transport Promise settles.
    if (data === 'M9\n') await cleanup;
  });
  try {
    await useLaserStore.getState().stopJob();
    expect(await measuring).toMatchObject({
      kind: 'failed',
      measurement: { complete: false, points: [] },
    });
    await flushConnect();
    expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(2);
    expect(writes.filter((line) => /G10|G92/.test(line))).toEqual([]);
    expect(writes.slice(writes.indexOf('\x18'))).toContain('M5\n');
    expect(writes.slice(writes.indexOf('\x18'))).toContain('M9\n');
    expect(useLaserStore.getState().probeBusy).toBe(false);
    const resetOwner = useLaserStore.getState().controllerOperation;
    expect(resetOwner).toMatchObject({ kind: 'recovery', phase: 'reset' });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().pendingTransportWrites).toBeGreaterThan(0);

    // Probe cancellation cannot clear Abort's replacement cleanup owner.
    connection.emitLine('<Idle|MPos:100,200,5|WCO:100,200,-5|FS:0,0>');
    connection.emitLine('<Idle|MPos:100,200,5|WCO:100,200,-5|FS:0,0>');
    await flushConnect();
    expect(useLaserStore.getState().controllerOperation).toBe(resetOwner);
  } finally {
    finishCleanup();
    write.mockRestore();
  }
  await vi.waitFor(() => {
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
  });
  expect(writes.filter((line) => line.includes('G38.2'))).toHaveLength(2);
  expect(writes.filter((line) => /G10|G92/.test(line))).toEqual([]);
  expect(writes.filter((line) => line === '\x18')).toHaveLength(1);
  expect(useLaserStore.getState().connection.kind).toBe('connected');
  expect(useLaserStore.getState().probeBusy).toBe(false);
});
