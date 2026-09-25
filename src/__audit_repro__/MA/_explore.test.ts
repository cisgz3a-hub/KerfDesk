import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { createFifoMarlin } from './marlin-fifo-model';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(async () => { await useLaserStore.getState().disconnect(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('model: M410 + M5 I stops the beam promptly', async () => {
  const marlin = createFifoMarlin();
  await useLaserStore.getState().connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
  marlin.emitLine('start');
  await vi.advanceTimersByTimeAsync(1500);
  const pts = [[50,50],[250,50],[250,55],[50,55],[50,60],[250,60],[250,65],[50,65],[50,70],[250,70]].map(([x,y]) => ({x: x!, y: y!}));
  const program = marlinStrategy.emit({ groups: [{ kind: 'cut', layerId: 'L1', color: '#f00', power: 80, speed: 300, passes: 1, airAssist: false, segments: [{ polyline: pts, closed: false }] }] },
    { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin', maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-inline' } });
  await startTestLaserJob(program, { streamingMode: 'ping-pong' });
  await vi.advanceTimersByTimeAsync(5000);
  const conn = await (await marlin.adapter.serial.requestPort()).open({ baudRate: 250000 });
  const t0 = Date.now();
  await conn.write('M410\nM5 I\n');
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(marlin.beamOnMsSince(t0)).toBeLessThan(500);
  expect(marlin.state().plannedBlocks).toBe(0);
});
