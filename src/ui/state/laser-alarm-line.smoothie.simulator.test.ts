// Controller audit SM-8: Smoothieware prints `ALARM: …` lines on its own when
// it halts — a hard limit (Endstops.cpp L420-L430), the kill button
// (KillButton.cpp L53-L64), Ctrl-X in grbl mode (USBSerial.cpp L302-L314) —
// or before a command's own `ok` (homing and probe failures). They answer no
// line, yet KerfDesk booked them as the terminal reply of whichever line was
// owed and told the operator an innocent in-flight job line was rejected.
// They are now a code-less alarm event: the stream stops and the raw text is
// logged, as GRBL's `ALARM:N` does.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L420-L430

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSmoothieSimulator,
  type CreateSmoothieSimulatorOptions,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const JOB = Array.from({ length: 40 }, (_, i) => `G1 X${i} Y1 F600 S0.5`).join('\n');

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    homingState: 'unknown',
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectSmoothieIdle(
  options: CreateSmoothieSimulatorOptions = {},
): Promise<SmoothieSimulator> {
  // Long moves so the job is still streaming when the board halts.
  const sim = createSmoothieSimulator({ motionMs: 200, ...options });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function rejectedLine(): string | undefined {
  const notice = useLaserStore.getState().safetyNotice;
  return notice?.kind === 'controller-error' ? notice.rejectedLine : undefined;
}

describe('SM-8: an unsolicited Smoothieware ALARM line', () => {
  it('stops the job without reporting the in-flight line as rejected', async () => {
    const sim = await connectSmoothieIdle();
    await startTestLaserJob(JOB, { streamingMode: 'ping-pong' });
    await pump(30);
    expect(useLaserStore.getState().streamer?.inFlight[0]?.line.trim()).toMatch(/^G1 /);

    // The X+ limit switch trips during the executing move.
    sim.hardLimit('+X');
    await pump(1);
    expect({ rejectedLine: rejectedLine() }).toEqual({ rejectedLine: undefined });
    const state = useLaserStore.getState();
    expect(state.streamer?.status).toBe('cancelled');
    expect(state.log).toContain('[lf2] Controller alarm: ALARM: Hard limit +X');

    // The halted board refuses the rest with `!!`: echoes of a stopped
    // stream, still not an operator-facing rejection.
    await pump(2_000);
    expect(rejectedLine()).toBeUndefined();
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  });

  it('logs the grbl-mode Abort alarm without a controller-error notice', async () => {
    const sim = await connectSmoothieIdle({ grblMode: true });
    await startTestLaserJob(JOB, { streamingMode: 'ping-pong' });
    await pump(30);
    await useLaserStore.getState().stopJob();
    await pump(1_000);
    expect(sim.state().isHalted).toBe(true);
    const state = useLaserStore.getState();
    expect(state.log).toContain('[lf2] Controller alarm: ALARM: Abort during cycle');
    expect(state.safetyNotice?.kind).not.toBe('controller-error');
  });
});
