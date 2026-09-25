import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { resolveJobPlacement } from '../../ui/job-placement';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ capabilities: grblDriver.capabilities, activeControllerKind: grblDriver.kind, connection: { kind: 'disconnected' }, statusReport: null, streamer: null, motionOperation: null, controllerOperation: null, wcoCache: null, workOriginActive: false, workOriginSource: 'none' });
  resetStore(); vi.useRealTimers(); vi.restoreAllMocks();
});
const pump = (ms = 10) => vi.advanceTimersByTimeAsync(ms);

it('explore origin state on smoothie', async () => {
  const sim = createSmoothieSimulator();
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1200);
  console.log('before', JSON.stringify({ wco: useLaserStore.getState().wcoCache, active: useLaserStore.getState().workOriginActive }));
  await useLaserStore.getState().jog({ dx: 12, dy: 5, feed: 1000 });
  await pump(900);
  const setOrigin = useLaserStore.getState().setOriginHere();
  await pump(4000);
  await setOrigin;
  await pump(1200);
  const s = useLaserStore.getState();
  console.log('after', JSON.stringify({ wco: s.wcoCache, active: s.workOriginActive, src: s.workOriginSource, report: s.statusReport, sim: sim.state().pos, log: s.log.slice(-4) }));
  for (const startFrom of ['user-origin', 'absolute', 'verified-origin', 'current-position'] as const) {
    console.log(startFrom, JSON.stringify(resolveJobPlacement({ startFrom, anchor: 'front-left' }, { statusReport: s.statusReport, workOriginActive: s.workOriginActive, wcoCache: s.wcoCache })));
  }
  expect(true).toBe(true);
});
