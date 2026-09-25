import { afterEach, beforeAll, beforeEach, it, vi } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/ma-explore3.txt';

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

beforeAll(() => writeFileSync(OUT, ''));
const BOOT_TAIL = [
  'PowerUp',
  'Marlin 2.1.2.8',
  'echo: Last Updated: 2024-01-01 | Author: (none, default config)',
  'echo: Compiled: Jun 25 2026',
  'echo: Free Memory: 4086  PlannerBufferBytes: 1152',
  'echo:Hardcoded Default Settings Loaded',
];

for (const gap of [0, 15, 400]) {
  it(`boot with gap ${gap}`, async () => {
    const sim = createMarlinSimulator({ emitBannerOnOpen: false });
    sim.port.onOpen(() => {
      setTimeout(() => {
        sim.port.emitLine('start');
        if (gap === 0) BOOT_TAIL.forEach((l) => sim.port.emitLine(l));
        else setTimeout(() => BOOT_TAIL.forEach((l) => sim.port.emitLine(l)), gap);
      }, 300);
    });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(4000);
    const s = useLaserStore.getState();
    appendFileSync(OUT, `gap=${gap} conn=${s.connection.kind} qual=${JSON.stringify(s.controllerQualification)} status=${s.statusReport?.state} epoch=${s.controllerSessionEpoch} pending=${s.pendingUntrackedAcks} op=${JSON.stringify(s.controllerOperation)} err=${s.lastWriteError}\n  outbound=${JSON.stringify(sim.outbound())}\n  log=${JSON.stringify(s.log.slice(-8))}\n`);
    const jog = useLaserStore.getState().jog({ dx: 1, feed: 1000 }).then(() => 'ok', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(2000);
    appendFileSync(OUT, `  jog=${await jog}\n`);
  });
}

