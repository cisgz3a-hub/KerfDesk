import { afterEach, beforeEach, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { laserCountdownTestHandoff } from '../../ui/state/laser-countdown-test-handoff';
import { createFifoMarlin } from './marlin-fifo-model';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(async () => { await useLaserStore.getState().disconnect(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('explore ma8', async () => {
  const program = marlinStrategy.emit({ groups: [{ kind: 'cut', layerId: 'L1', color: '#f00', power: 50, speed: 300, passes: 1, airAssist: false, segments: [{ polyline: [{x:200,y:200},{x:260,y:200}], closed: false }] }] },
    { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin', maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-inline' } });
  const marlin = createFifoMarlin();
  await useLaserStore.getState().connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
  marlin.emitLine('start');
  await vi.advanceTimersByTimeAsync(1500);
  const trace: string[] = [];
  const jog = useLaserStore.getState().jog({ dx: 0.1, feed: 6000 }).then(() => 'ok', (e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(2000);
  trace.push('jog=' + await jog);
  trace.push(JSON.stringify({ op: useLaserStore.getState().motionOperation, cop: useLaserStore.getState().controllerOperation, pending: useLaserStore.getState().pendingUntrackedAcks }));
  const start = startTestLaserJob(program, { streamingMode: 'ping-pong', ...laserCountdownTestHandoff({ gcode: program, retentionKey: 'x', capability: 'settle-only' }) }).then(() => 'ok', (e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(100);
  trace.push('start=' + await start);
  trace.push(JSON.stringify(useLaserStore.getState().liveCanvasRun?.timing).slice(0, 300));
  trace.push(JSON.stringify(marlin.outbound()));
  writeFileSync('/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/ma8.txt', trace.join('\n'));
});
