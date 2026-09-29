// Controller audit 2 (ADR-375), C-2: Abort for motion a Console command
// started, against the GRBL simulator. Nothing here owns that motion, so Abort
// used to send the soft reset straight into it: GRBL kills the steppers in a
// cycle or a jog and raises ALARM:3, "position has likely been lost".
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L386

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Connect the real store, finish the handshake and wait for the first Idle
 *  report on the one-second idle poll. */
async function connectIdle(options: CreateGrblSimulatorOptions): Promise<GrblSimulator> {
  const sim = createGrblSimulator(options);
  await useLaserStore.getState().connect(sim.adapter);
  await pump(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

/** Send a Console line and wait for the idle poll to report its motion. */
async function consoleMotion(line: string, reported: 'Run' | 'Jog'): Promise<void> {
  const sent = useLaserStore.getState().sendConsoleCommand(line);
  await pump(50);
  await sent;
  await pump(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe(reported);
}

/** Abort, and the bytes written from then on. */
async function abort(sim: GrblSimulator): Promise<ReadonlyArray<string>> {
  const before = sim.outbound().length;
  const stopping = useLaserStore.getState().stopJob();
  await pump(500);
  await stopping;
  return sim.outbound().slice(before);
}

function withoutStatusQueries(written: ReadonlyArray<string>): ReadonlyArray<string> {
  return written.filter((data) => data !== '?');
}

describe('Abort for Console motion on GRBL', () => {
  it('holds a Console G1 and resets only once the hold is complete', async () => {
    const sim = await connectIdle({ motionMs: 5_000 });
    await consoleMotion('G1 X300 F100', 'Run');

    const written = await abort(sim);

    // The reset waits for a status report asked for after the hold.
    const hold = written.indexOf('!');
    const reset = written.indexOf('\x18');
    expect(withoutStatusQueries(written)[0]).toBe('!');
    expect(written.slice(hold, reset)).toContain('?');
    expect(reset).toBeGreaterThan(hold);
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(sim.state().machine).toBe('Idle');
  });

  it('cancels a Console jog with jog cancel and no reset', async () => {
    const sim = await connectIdle({ motionMs: 5_000 });
    await consoleMotion('$J=G91 X50 F1000', 'Jog');

    const written = await abort(sim);

    expect(withoutStatusQueries(written)).toEqual(['\x85']);
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(sim.state().machine).toBe('Idle');
  });
});
