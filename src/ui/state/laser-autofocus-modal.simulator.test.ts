import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { useLaserStore } from './laser-store';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
});

it('replaces Console G91 with acknowledged G90 before an autofocus probe', async () => {
  const sim = createGrblSimulator();
  await useLaserStore.getState().connect(sim.adapter);
  await vi.advanceTimersByTimeAsync(1_500);
  const relative = useLaserStore.getState().sendConsoleCommand('G91');
  await vi.advanceTimersByTimeAsync(500);
  await relative;
  expect(sim.state().isAbsolute).toBe(false);

  const before = sim.outbound().length;
  const focus = useLaserStore.getState().autofocus('G38.2 Z-10 F100');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await focus).toEqual({ kind: 'ok' });
  const sent = sim
    .outbound()
    .slice(before)
    .filter((line) => line !== '?');
  expect(sent).toEqual(['G21\n', 'G90\n', 'G38.2 Z-10 F100\n']);
  // The simulator models the firmware modal state, not probe contact travel.
  expect(sim.state().isAbsolute).toBe(true);
  expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
});
