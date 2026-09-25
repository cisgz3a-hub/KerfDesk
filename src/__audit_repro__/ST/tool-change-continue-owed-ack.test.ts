// ST-1 (variant) repro — Continue at a CNC tool-change hold streams the next
// section while an operator command's terminal `ok` is still owed, and the
// stream then claims that `ok` as its own line.
//
// Correct behaviour: GRBL answers lines strictly in receive order
// (protocol_main_loop: one report_status_message per EOL,
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L78-L110).
// A queued operator line (here a second Zero Z, `G10 L20 P1 Z0`) written
// before the resumed job window is answered first, so its `ok` must settle the
// untracked ledger and must not free job RX budget. Character counting is only
// safe while every `ok` that frees bytes belongs to a counted line
// (wiki Grbl-v1.1-Interface "Streaming Protocol: Character-Counting",
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface).
//
// KerfDesk's ownership rule (laser-stream-ack.ts settleUntrackedAck) gives
// every terminal ack to the stream while `hasUnsettledStreamAcks` is true,
// which is always true once the status is 'streaming'. That rule is only
// sound when no untracked line can precede a stream line on the wire, which
// Start guarantees (prepareStartBoundary refuses while hasPendingControllerWrite)
// but Continue does not check. The owed `ok` therefore pops the first resumed
// job line: the streamer believes that line's bytes left GRBL's RX ring while
// they are still there, so its next refill can exceed the ring (GRBL drops
// the excess bytes silently: serial.c:191-195 "Write data to buffer unless it
// is full"), and the operator's Zero Z never receives its acknowledgement.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from '../../ui/state/cnc-setup-attestation';
import { useLaserStore } from '../../ui/state/laser-store';
import { toolChangeContinueBlockMessage } from '../../ui/state/laser-store-helpers';
import { respondToTestGrblBuildInfo } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';

const IDLE = '<Idle|MPos:10.000,20.000,-1.000|FS:0,0|Ov:100,100,100>';

type Device = SerialConnection & {
  readonly say: (line: string) => void;
  machine: 'Idle' | 'Jog';
  autoAckSettleDwell: boolean;
};

// Answers `?` and the handshake itself; every queued line is acknowledged by
// the test, in wire order, exactly when the test says so.
function makeDevice(sent: string[]): Device {
  const handlers = new Set<(line: string) => void>();
  const device: Device = {
    machine: 'Idle',
    autoAckSettleDwell: true,
    write: async (data) => {
      sent.push(data);
      if (data === '?') {
        setTimeout(
          () => device.say(device.machine === 'Idle' ? IDLE : IDLE.replace('Idle', 'Jog')),
          0,
        );
      }
      // The CNC Start queue fence (a settle dwell) is answered like the jog test harness does.
      if (data === 'G4 P0.01\n' && device.autoAckSettleDwell) {
        setTimeout(() => device.say('ok'), 0);
      }
      respondToTestGrblBuildInfo(data, device.say);
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await settle(5);
  }
  throw new Error('condition not reached');
}

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
  'G1 X7 Y7',
  'G1 X8 Y8',
].join('\n');

async function holdAtToolChange(device: Device): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(device));
  device.say("Grbl 1.1h ['$' for help]");
  device.say(IDLE);
  await settle(0);
  device.say('ok');
  device.say(IDLE);
  await settle();
  await useLaserStore.getState().startJob(TWO_BIT_JOB, {
    machineKind: 'cnc',
    cncSetupAttestation: createCncSetupAttestation(
      TWO_BIT_JOB,
      cncControllerEpochOf(useLaserStore.getState()),
    ),
  });
  while ((useLaserStore.getState().streamer?.inFlight.length ?? 0) > 0) {
    device.say('ok');
    await settle(0);
  }
  device.say(IDLE);
  await settle();
}

async function zeroZAcknowledged(device: Device, sent: string[]): Promise<void> {
  const before = sent.length;
  const done = useLaserStore.getState().zeroZHere();
  await waitFor(() => sent.slice(before).some((data) => data.includes('Z0')));
  device.say('ok');
  await done;
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
    pendingUntrackedAcks: 0,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('ST-1 variant: Continue while an operator command still owes its ok', () => {
  it('keeps the owed ok off the job stream accounting', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');

    // First touch-off: completes normally and records work-Z evidence.
    await zeroZAcknowledged(device, sent);
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();

    // Second touch-off: its G10 line is on the wire, its ok not yet received.
    const before = sent.length;
    const secondZero = useLaserStore.getState().zeroZHere().catch((error: unknown) => error);
    await waitFor(() => sent.slice(before).some((data) => data.includes('Z0')));
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    const gate = toolChangeContinueBlockMessage(useLaserStore.getState());

    // The operator presses Continue; the resumed window follows the G10 on the wire.
    await useLaserStore.getState().continueToolChange();
    const resumed = useLaserStore.getState().streamer;
    expect(resumed?.status).toBe('streaming');
    const linesSentForJob = resumed?.inFlight.length ?? 0;
    const bytesSentForJob = resumed?.inFlightBytes ?? 0;
    expect(linesSentForJob).toBeGreaterThan(0);

    // GRBL answers the G10 first (strict receive order).
    device.say('ok');
    await settle(0);
    const afterG10Ok = useLaserStore.getState();
    const snapshot = {
      continueGate: gate,
      // Every resumed job line is still unanswered in GRBL's RX ring.
      streamInFlightLines: afterG10Ok.streamer?.inFlight.length,
      streamInFlightBytes: afterG10Ok.streamer?.inFlightBytes,
      pendingUntrackedAcks: afterG10Ok.pendingUntrackedAcks,
    };

    // Then the resumed job lines, the post-job settle marker and Idle reports.
    for (let i = 0; i < linesSentForJob; i += 1) {
      device.say('ok');
      await settle(0);
    }
    device.say(IDLE);
    await settle(50);
    device.say(IDLE);
    await settle(50);
    device.say(IDLE);
    await settle(50);
    const finished = useLaserStore.getState();
    const afterJob = {
      streamer: finished.streamer?.status ?? null,
      // A settled controller owes nothing; a stuck count blocks Start, Jog,
      // Frame, Home and origin writes until the port is reconnected
      // (laser-start-queue-fence.ts startPendingControllerMessage).
      pendingUntrackedAcks: finished.pendingUntrackedAcks,
    };

    expect({ snapshot, afterJob }).toEqual({
      snapshot: {
        continueGate: expect.any(String),
        streamInFlightLines: linesSentForJob,
        streamInFlightBytes: bytesSentForJob,
        pendingUntrackedAcks: 0,
      },
      afterJob: { streamer: null, pendingUntrackedAcks: 0 },
    });
    void secondZero;
  });

  it('keeps the jog settle-marker ok off the job stream accounting', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    await zeroZAcknowledged(device, sent);
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();

    // Operator jog: GRBL acks `$J=` at parse time, reports Jog, then Idle.
    const jogBefore = sent.length;
    const jog = useLaserStore.getState().jog({ dz: 10, feed: 300 });
    await waitFor(() => sent.slice(jogBefore).some((data) => data.startsWith('$J=')));
    device.say('ok');
    await jog;
    device.machine = 'Jog';
    await settle(300);
    // The jog ends; on the next Idle report the jog owner dispatches its
    // planner-drain marker (laser-jog-actions startSettledJogOperation), whose
    // ok GRBL has not sent yet.
    device.autoAckSettleDwell = false;
    device.machine = 'Idle';
    const markerBefore = sent.length;
    await waitFor(() => sent.slice(markerBefore).includes('G4 P0.01\n'));
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().motionOperation?.kind).toBe('jog');
    const gate = toolChangeContinueBlockMessage(useLaserStore.getState());

    await useLaserStore.getState().continueToolChange();
    const resumed = useLaserStore.getState().streamer;
    const linesSentForJob = resumed?.inFlight.length ?? 0;
    expect(linesSentForJob).toBeGreaterThan(0);

    // GRBL answers the earlier marker first.
    device.say('ok');
    await settle(0);
    const after = useLaserStore.getState();
    expect({
      continueGate: gate,
      streamInFlightLines: after.streamer?.inFlight.length,
      pendingUntrackedAcks: after.pendingUntrackedAcks,
      jogOwnerSawItsMarkerAck: after.motionOperation?.settlementAckStatusSequence !== undefined,
    }).toEqual({
      continueGate: expect.any(String),
      streamInFlightLines: linesSentForJob,
      pendingUntrackedAcks: 0,
      jogOwnerSawItsMarkerAck: true,
    });
  });
});
