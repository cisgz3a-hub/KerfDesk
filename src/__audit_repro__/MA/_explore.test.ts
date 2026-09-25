import { afterEach, beforeAll, beforeEach, it, vi } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/ma-explore4.txt';
beforeAll(() => writeFileSync(OUT, ''));
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('error+ok during stream', async () => {
  const sim = createMarlinSimulator({ motionMs: 3000 });
  sim.port.onWrite((data) => {
    if (/X13\b/.test(data)) sim.port.emitLine('Error:G2/G3 bad parameters');
  });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await vi.advanceTimersByTimeAsync(1200);
  const job = Array.from({ length: 30 }, (_, i) => `G1 X${i} Y1 F600 S200`).join('\n');
  await startTestLaserJob(job, { streamingMode: 'ping-pong' });
  for (let t = 0; t < 60; t += 1) {
    await vi.advanceTimersByTimeAsync(t < 40 ? 5 : 200);
    const s = useLaserStore.getState();
    appendFileSync(OUT, `t=${t} streamer=${s.streamer?.status}/${s.streamer?.completed} inflight=${s.streamer?.inFlight.length} pending=${s.pendingUntrackedAcks} sim.pending=${sim.state().pendingMotions} status=${s.statusReport?.state} notice=${s.safetyNotice?.kind} out=${JSON.stringify(sim.outbound().slice(-3))}\n`);
  }
  appendFileSync(OUT, `transcript=${JSON.stringify(useLaserStore.getState().log.slice(-15))}\n`);
});
