// Audit track MA (Marlin), finding MA-12: Marlin's "Unknown command" reply is
// treated as success, so a job line the firmware skipped (air assist M8, the
// inline laser's M3 I, the fan laser's M106) streams on as if it ran.
//
// Marlin 2.1.2.8 dispatches M3/M4/M5 only with HAS_CUTTER (gcode.cpp
// L489-L493), M7 only with COOLANT_MIST (L495-L497), M8 only with AIR_ASSIST or
// COOLANT_FLOOD (L499-L501), M9 only with AIR_ASSIST or COOLANT_CONTROL
// (L503-L505) and M106/M107 only with HAS_FAN (L591-L594). LASER_FEATURE,
// AIR_ASSIST and the coolant options are all commented out in the stock
// Configuration_adv.h (L3334, L3353; coolant L3515-L3516 sit inside a disabled
// `//#define COOLANT_CONTROL` block), so each is a build choice. Any other
// command falls to `parser.unknown_command_warning()` (gcode.cpp L1101/L1119),
// which prints `echo:Unknown command: "M8"` (parser.cpp L390-L392), and then
// `if (!no_ok) queue.ok_to_send();` (gcode.cpp L1122): the line is
// acknowledged and nothing happened.
// KerfDesk classifies that echo as a plain `message` (marlin/response.ts
// ECHO_RE, L16 and L32-L33) and the line handler ignores messages
// (laser-line-handler.ts routeAcknowledgement returns for any kind but `ok`),
// so the stream advances on the `ok` that follows. On the GRBL family the same
// mismatch is `error:20` and ends the stream.
// Consequence here: a Marlin laser whose firmware lacks AIR_ASSIST cuts with
// the air assist the operator selected silently off; one without LASER_FEATURE
// runs an inline program dark.
// bugfix-2.1.x (3b2b9ca6) is the same (gcode.cpp L491-L507, L594-L595, L1167,
// L1185-L1188).
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L489-L506
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/parser.cpp#L390-L392
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122
//
// Correct behaviour (minimum, whichever product answer is chosen — stop the
// stream as GRBL's error:20 does, or warn and continue): an "Unknown command"
// echo for a line of a running job is surfaced to the operator as a safety
// notice naming the skipped command, not silently accepted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
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

describe('MA-12: Marlin "Unknown command" is accepted as success', () => {
  it('tells the operator a job line was skipped by the firmware', async () => {
    const sim = createMarlinSimulator({ motionMs: 20 });
    // A build without AIR_ASSIST/COOLANT_FLOOD: M8 and M9 are unknown commands.
    // The echo precedes the `ok` the simulator sends 1 ms later, as in Marlin.
    sim.port.onWrite((data) => {
      const command = data.trim();
      if (/^M[89]\b/.test(command)) sim.port.emitLine(`echo:Unknown command: "${command}"`);
    });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);

    await startTestLaserJob('M8\nM3 I S0\nG1 X10 F600 S200\nG1 X20 S200\nM5 I\nM9\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(3_000);

    // The firmware said so; it reached the Laser Log only.
    expect(
      useLaserStore.getState().log.some((line) => line.includes('Unknown command: "M8"')),
    ).toBe(true);
    // Current code: every burn move after the skipped M8 was sent (the wire
    // carries `G1 X20 S200`), the job completed as a clean run, and no notice
    // was raised.
    const notice = useLaserStore.getState().safetyNotice;
    expect(notice).not.toBeNull();
    expect(notice?.message ?? '').toContain('M8');
  });
});
