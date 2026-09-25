// Audit track MA (Marlin), finding MA-12: Marlin's "Unknown command" reply is
// treated as success, so a job line the firmware skipped (air assist M8, the
// inline laser's M3 I, the fan laser's M106) streams on as if it ran.
//
// Marlin 2.1.2.8 dispatches M8 only with AIR_ASSIST or COOLANT_FLOOD, M7 only
// with COOLANT_MIST, M3/M4/M5 only with HAS_CUTTER, M106/M107 only with
// HAS_FAN (gcode.cpp L489-L506, L591-L593); none of them is enabled in the
// stock configuration. Any other command falls to
// `parser.unknown_command_warning()` ("echo:Unknown command: \"M8\"",
// parser.cpp L390-L392) and then `queue.ok_to_send()` (gcode.cpp L1114-L1122):
// the line is acknowledged and nothing happened.
// KerfDesk classifies that echo as a plain `message` (marlin/response.ts
// ECHO_RE) and the handler ignores messages (laser-line-handler.ts
// routeAcknowledgement returns for any kind but `ok`), so the stream advances.
// On the GRBL family the same mismatch is `error:20` and ends the stream.
// Consequence here: a Marlin laser whose firmware lacks AIR_ASSIST cuts with
// the air assist the operator selected silently off.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L489-L506
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/parser.cpp#L390-L392
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122
//
// Correct behaviour: an "Unknown command" echo for a line of a running job is
// surfaced as a rejection of that line (stream errored, or at minimum a
// safety notice naming the skipped command), not silently accepted.

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
  it('does not stream on past a job line the firmware did not run', async () => {
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

    expect(
      useLaserStore.getState().log.some((line) => line.includes('Unknown command: "M8"')),
    ).toBe(true);
    // Current code: the burn moves after the skipped M8 were all sent and the
    // job completed cleanly with no notice.
    expect(sim.outbound()).not.toContain('G1 X20 S200\n');
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
  });
});
