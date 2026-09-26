// Regression tests for audit findings status-5 and settings-console-6: on
// Marlin, whose only status source is the queued M114 poll, manual motion and
// Idle-requiring Console commands were refused whenever the cached report was
// over 1000 ms old, with a message claiming a status query had been sent,
// although none was and the controller could answer M114 at once
// (https://marlinfw.org/docs/gcode/M114.html). The oracle is the scripted
// Marlin simulator's wire traffic: an M114 goes out, and the command follows
// only after that query's own `ok`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

const MARLIN_JOG_X1 = 'G21\nG91\nG0 X1.000 F1000\nG90\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
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

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectMarlinIdle(): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator({ responseDelayMs: 20 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await pump(1_120);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function m114Count(sim: MarlinSimulator): number {
  return sim.outbound().filter((write) => write === 'M114\n').length;
}

async function nextM114PollTime(sim: MarlinSimulator): Promise<number> {
  const before = m114Count(sim);
  for (let elapsed = 0; elapsed < 1_500; elapsed += 1) {
    await pump(1);
    if (m114Count(sim) > before) return Date.now();
  }
  throw new Error('No idle M114 poll within 1.5 s');
}

function outcomeOf(pending: Promise<void>): Promise<string> {
  return pending.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe('Marlin manual motion with a cached M114 older than the freshness window', () => {
  it('queries M114, waits for its ok, then jogs', async () => {
    const sim = await connectMarlinIdle();
    // Operator traffic at the idle tick skips that poll, so the cached report
    // ages past 1000 ms with nothing in flight.
    const pollAt = await nextM114PollTime(sim);
    await pump(pollAt + 985 - Date.now());
    const pollsBefore = m114Count(sim);
    await useLaserStore.getState().sendConsoleCommand('M105');
    await pump(pollAt + 1_100 - Date.now());
    expect(m114Count(sim)).toBe(pollsBefore);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    const before = sim.outbound().length;

    const outcome = outcomeOf(useLaserStore.getState().jog({ dx: 1, feed: 1000 }));
    await pump(20);
    // The query is out; the jog waits for its report and then for its ok.
    expect(sim.outbound().slice(before)).toEqual(['M114\n']);
    await pump(200);

    expect(await outcome).toBe('resolved');
    // Later M114s belong to the jog's own settlement.
    expect(sim.outbound().slice(before, before + 2)).toEqual(['M114\n', MARLIN_JOG_X1]);
  });

  it('accepts a second state-changing Console command 200 ms after the first', async () => {
    const sim = await connectMarlinIdle();
    expect(await outcomeOf(sendAndPump('M106 S0'))).toBe('resolved');
    await pump(150);
    const before = sim.outbound().length;

    // The first command cleared the cached status; the second queries afresh
    // instead of being refused.
    expect(await outcomeOf(sendAndPump('M107'))).toBe('resolved');
    expect(sim.outbound().slice(before)).toEqual(['M114\n', 'M107\n']);
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });
});

async function sendAndPump(command: string): Promise<void> {
  const pending = useLaserStore.getState().sendConsoleCommand(command);
  await pump(200);
  return pending;
}
