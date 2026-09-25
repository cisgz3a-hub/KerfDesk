// ST-1 repro — Continue at a CNC tool-change hold is offered, and streams the
// next section, while the operator's own jog is still moving the machine.
//
// Correct behaviour: Continue must not put G-code on the wire while the
// controller is still in its Jog state. GRBL 1.1h locks every non-`$` line out
// while jogging and answers it with error:9 (STATUS_SYSTEM_GC_LOCK):
//   grbl/protocol.c:99-101
//     } else if (sys.state & (STATE_ALARM | STATE_JOG)) {
//       // Everything else is gcode. Block if in alarm or jog mode.
//       report_status_message(STATUS_SYSTEM_GC_LOCK);
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L99-L101
// grblHAL does the same (protocol.c:256 `else if(state_get() & (STATE_ALARM|STATE_ESTOP|STATE_JOG))`
// ... `gc_state.last_error = Status_SystemGClock;`).
// KerfDesk's own owned-motion settlement already knows this ("GRBL rejects the
// G4 marker while jogging", laser-owned-motion-settlement.ts), but the Continue
// gate (toolChangeContinueBlockMessage) only checks the hold's latched fresh
// Idle, the drained tail and work-Z evidence — not an active jog owner or the
// controller's current state. So Continue is enabled mid-jog, the first resumed
// line is rejected with error:9, the stream becomes 'errored', and the auto-stop
// soft-resets a controller that is still jogging (mc_reset during STATE_JOG
// raises ALARM:3 and kills the steppers: motion_control.c:380-385). The job is
// lost at the tool change.
//
// The device below is a minimal GRBL 1.1h stand-in that models only the
// protocol.c:99 lock-out (the shared grbl-simulator accepts G-code in Jog and
// switches to Run, which is why no existing test sees this).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from '../../ui/state/cnc-setup-attestation';
import { useLaserStore } from '../../ui/state/laser-store';
import { toolChangeContinueBlockMessage } from '../../ui/state/laser-store-helpers';
import { respondToTestGrblBuildInfo } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';

type Machine = 'Idle' | 'Jog' | 'Alarm';
type Device = SerialConnection & {
  readonly say: (line: string) => void;
  machine: Machine;
};

function statusLine(machine: Machine): string {
  return `<${machine}|MPos:10.000,20.000,-1.000|FS:0,0|Ov:100,100,100>`;
}

// One queued line, answered as GRBL 1.1h would. Returns the response.
function answerLine(device: Device, line: string): string {
  if (line.startsWith('$J=')) {
    device.machine = 'Jog';
    return 'ok';
  }
  if (line.startsWith('$')) return 'ok';
  // protocol.c:99-101 — G-code is locked out in Alarm and Jog.
  return device.machine === 'Jog' || device.machine === 'Alarm' ? 'error:9' : 'ok';
}

// mc_reset() during STATE_JOG raises ALARM:3; main() re-inits and prints the banner.
function softReset(device: Device, later: (line: string) => void): void {
  const wasMoving = device.machine === 'Jog';
  device.machine = wasMoving ? 'Alarm' : 'Idle';
  if (wasMoving) later('ALARM:3');
  later("Grbl 1.1h ['$' for help]");
  if (wasMoving) later("[MSG:'$H'|'$X' to unlock]");
}

function isHandshakeBuildInfo(data: string): boolean {
  return (
    data === '$I\n' &&
    useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
  );
}

function makeDevice(sent: string[]): Device {
  const handlers = new Set<(line: string) => void>();
  const later = (line: string): void => {
    setTimeout(() => device.say(line), 0);
  };
  const device: Device = {
    machine: 'Idle',
    write: async (data) => {
      sent.push(data);
      if (data === '?') later(statusLine(device.machine));
      else if (data === '\x18') softReset(device, later);
      else if (isHandshakeBuildInfo(data)) respondToTestGrblBuildInfo(data, later);
      else {
        for (const line of data.split('\n')) {
          if (line.trim() !== '') later(answerLine(device, line));
        }
      }
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    say: (line) => {
      for (const handler of handlers) handler(line);
    },
  };
  return device;
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function settle(ms = 20): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

// Two bits as the CNC emitter shapes them (cnc-grbl-transitions.ts
// appendToolChange): retract, M5, park, load marker, bare M0, modal restate,
// safe-Z lift, spindle start.
const TWO_BIT_JOB = [
  'G21',
  'G90',
  'M3 S10000',
  'G1 Z-1 F200',
  'G1 X5 Y5 F800',
  'G0 Z5',
  'M5',
  'G0 X0 Y0',
  `${TOOL_CHANGE_LOAD_PREFIX}3.175 mm end mill`,
  'M0',
  'G21 G90 G54 G94 G17',
  'G0 Z5',
  'M3 S12000',
  'G1 X6 Y6 F800',
].join('\n');

async function holdAtToolChange(device: Device): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(device));
  device.say("Grbl 1.1h ['$' for help]");
  device.say(statusLine('Idle'));
  await settle(50);
  await useLaserStore.getState().startJob(TWO_BIT_JOB, {
    machineKind: 'cnc',
    cncSetupAttestation: createCncSetupAttestation(
      TWO_BIT_JOB,
      cncControllerEpochOf(useLaserStore.getState()),
    ),
  });
  // The device acks every job line; let the pre-M0 tail drain and a fresh Idle arrive.
  await settle(400);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect().catch(() => undefined);
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    toolChangeIdleSeen: false,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('ST-1: Continue during an operator jog inside a tool-change hold', () => {
  it('does not stream the next section while the controller is still jogging', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(useLaserStore.getState().toolChangeIdleSeen).toBe(true);

    // Touch off the new bit: Zero Z records work-Z evidence for the hold.
    await useLaserStore.getState().zeroZHere();
    await settle();
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();

    // The operator lifts Z with an ordinary jog. GRBL acks `$J=` at parse
    // time and stays in STATE_JOG while the move runs.
    await useLaserStore.getState().jog({ dz: 10, feed: 300 });
    await settle(300);
    expect(device.machine).toBe('Jog');
    expect(useLaserStore.getState().statusReport?.state).toBe('Jog');
    expect(useLaserStore.getState().motionOperation?.kind).toBe('jog');

    // Evidence of the defect #1: the Continue button is enabled mid-jog.
    const gate = toolChangeContinueBlockMessage(useLaserStore.getState());

    sent.length = 0;
    await useLaserStore
      .getState()
      .continueToolChange()
      .catch(() => undefined);
    await settle(200);

    const gcodeWrittenWhileJogging = sent.filter(
      (data) => data !== '?' && !data.startsWith('$') && data !== '\x18',
    );
    const after = useLaserStore.getState();
    const snapshot = {
      continueGate: gate,
      gcodeWrittenWhileJogging,
      streamerStatus: after.streamer?.status ?? null,
      softResetSent: sent.includes('\x18'),
      alarmCode: after.alarmCode,
    };
    // Correct behaviour: Continue is refused (gate names the running jog) and
    // nothing but status queries reaches the jogging controller.
    expect(snapshot).toEqual({
      continueGate: expect.any(String),
      gcodeWrittenWhileJogging: [],
      streamerStatus: 'tool-change',
      softResetSent: false,
      alarmCode: null,
    });
  });
});
