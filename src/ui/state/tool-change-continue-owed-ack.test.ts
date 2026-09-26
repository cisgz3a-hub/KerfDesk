// Controller audit 2026-09-25 ST-1 (regression): Continue at a CNC tool-change
// hold used to stream the next section while an operator command's terminal
// `ok` was still owed, and the stream then claimed that `ok` as its own line.
//
// GRBL answers lines strictly in receive order (protocol_main_loop: one
// report_status_message per EOL,
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L78-L110).
// Once the stream runs, every terminal ack is booked to it
// (laser-stream-ack.ts), so an owed `ok` for a Zero Z or a jog's settle marker
// would free RX budget for a job line still sitting in GRBL's ring, and the
// operator command would never see its answer. Continue now waits until
// nothing the operator sent is still owed an answer, like Start's queue fence.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import {
  TOOL_CHANGE_ACK_OWED_MESSAGE,
  TOOL_CHANGE_MOTION_ACTIVE_MESSAGE,
  toolChangeContinueBlockMessage,
} from './laser-store-helpers';
import { respondToTestGrblBuildInfo } from './laser-test-start-helpers';
import { useStore } from './store';

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
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
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

describe('Continue waits for the operator commands of the hold (audit ST-1)', () => {
  it('refuses Continue while a Zero Z still owes its ok, then continues once it is answered', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    await zeroZAcknowledged(device, sent);
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();

    // Second touch-off: its G10 line is on the wire, its ok not yet received.
    const before = sent.length;
    const secondZero = useLaserStore.getState().zeroZHere();
    await waitFor(() => sent.slice(before).some((data) => data.includes('Z0')));
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    // Zero Z is an owned exchange, so the gate names the running operation.
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).toMatch(
      /controller operation is active/,
    );

    const beforeContinue = sent.length;
    await useLaserStore.getState().continueToolChange();
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(sent.slice(beforeContinue).filter((data) => data !== '?')).toEqual([]);

    // GRBL answers the G10; the hold is handed back only now.
    device.say('ok');
    await secondZero;
    device.say(IDLE);
    await settle();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).toBeNull();
    await useLaserStore.getState().continueToolChange();
    const resumed = useLaserStore.getState().streamer;
    expect(resumed?.status).toBe('streaming');
    expect(resumed?.inFlight.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses Continue while an unowned line still owes its ok', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    await zeroZAcknowledged(device, sent);
    device.say(IDLE);
    await settle();
    // A ledger entry with no owner: the gate reads the ledger itself.
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).toBe(
      TOOL_CHANGE_ACK_OWED_MESSAGE,
    );
    const beforeContinue = sent.length;
    await useLaserStore.getState().continueToolChange();
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(sent.slice(beforeContinue).filter((data) => data !== '?')).toEqual([]);
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
  });

  it('refuses Continue while a jog still owns its settle marker', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    await zeroZAcknowledged(device, sent);

    // Operator jog: GRBL acks `$J=` at parse time, reports Jog, then Idle.
    const jogBefore = sent.length;
    const jog = useLaserStore.getState().jog({ dz: 10, feed: 300 });
    await waitFor(() => sent.slice(jogBefore).some((data) => data.startsWith('$J=')));
    device.say('ok');
    await jog;
    device.machine = 'Jog';
    await settle(300);
    // The jog ends; on the next Idle report the jog owner dispatches its
    // planner-drain marker, whose ok GRBL has not sent yet.
    device.autoAckSettleDwell = false;
    device.machine = 'Idle';
    const markerBefore = sent.length;
    await waitFor(() => sent.slice(markerBefore).includes('G4 P0.01\n'));
    expect(useLaserStore.getState().motionOperation?.kind).toBe('jog');
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).toBe(
      TOOL_CHANGE_MOTION_ACTIVE_MESSAGE,
    );

    const beforeContinue = sent.length;
    await useLaserStore.getState().continueToolChange();
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(sent.slice(beforeContinue).filter((data) => data !== '?')).toEqual([]);
  });
});
