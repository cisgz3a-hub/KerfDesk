// Audit SM-8 repro: an ALARM line Smoothieware prints on its own is booked
// against whichever line KerfDesk is waiting on, and the operator is told that
// line was rejected.
//
// Correct behaviour: Smoothieware's `ALARM: Hard limit ..`, `ALARM: Kill button
// pressed ..` and (grbl mode) `ALARM: Abort during cycle` are printed from the
// idle loop to every stream when the machine halts; they answer no command.
// KerfDesk must not settle an owed acknowledgement with them or name an
// innocent in-flight line as "rejected" (the GRBL driver already follows this
// rule: ADR-362 "ALARM:N acknowledges no line"). The halt itself is proven by
// the Alarm status report that follows.
//
// Upstream evidence (Smoothieware edge 38e2cc08):
// - Endstops::on_idle prints `ALARM: Hard limit %c%c` then halts
//   (src/modules/tools/endstops/Endstops.cpp L420-L430).
// - KillButton::on_idle prints `ALARM: Kill button pressed - reset, $X or M999
//   to clear HALT` (src/modules/utils/killbutton/KillButton.cpp L53-L64).
// - USBSerial::on_idle prints `ALARM: Abort during cycle` (grbl mode) for Ctrl-X
//   (src/libs/USBDevice/USBSerial/USBSerial.cpp L302-L314).
// - A G1's own `ok` is printed before it is planned (GcodeDispatch.cpp
//   L212-L218), so in ping-pong the in-flight line is the one after the move
//   that was running when the limit tripped.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L420-L430
//
// KerfDesk: classifySmoothieResponse maps every /^ALARM/i line to a terminal
// `error` (core/controllers/smoothieware/response.ts L33-L35); settleUntrackedAck
// treats `error` as a terminal ack (ui/state/laser-stream-ack.ts L56) and
// handleErrorLine names the stream's in-flight line (ui/state/laser-error-line.ts
// L28-L31, L43).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

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

async function connectSmoothieIdle(): Promise<SmoothieSimulator> {
  // Long moves so the job is still streaming when the limit trips.
  const sim = createSmoothieSimulator({ motionMs: 200 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

const JOB = Array.from({ length: 40 }, (_, i) => `G1 X${i} Y1 F600 S0.5`).join('\n');

describe('SM-8: an unsolicited Smoothieware ALARM line', () => {
  it('is not reported as the controller rejecting the in-flight job line', async () => {
    const sim = await connectSmoothieIdle();
    await startTestLaserJob(JOB, { streamingMode: 'ping-pong' });
    await pump(30);
    const inFlight = useLaserStore.getState().streamer?.inFlight[0]?.line.trim();
    expect(inFlight).toMatch(/^G1 /);

    // The X+ limit switch trips during the move that is executing: Endstops
    // prints the ALARM line from its idle loop and halts the board.
    sim.port.emitLine('ALARM: Hard limit +X');
    sim.triggerHalt();
    await pump(1);

    const notice = useLaserStore.getState().safetyNotice;
    // Fails today: rejectedLine is the innocent in-flight G1 and the message
    // reads "The controller rejected a command (unrecognized controller error
    // response: ALARM: Hard limit +X) during the job ... Rejected line: G1 ...".
    expect(
      { rejectedLine: notice?.kind === 'controller-error' ? notice.rejectedLine : undefined },
      notice?.message,
    ).toEqual({ rejectedLine: undefined });
  });
});
