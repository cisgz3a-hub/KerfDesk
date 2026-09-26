// A missed touch-off probe during a CNC tool-change hold (controller audit
// streaming-3). ALARM:4/5 stop only the probe, so a hold that had drained and
// seen Idle survives them: the operator unlocks, re-zeroes the new bit and
// presses Continue. Continue waits for a fresh Idle and new work-Z evidence;
// every other alarm, and an Alarm report with no numbered alarm, still cancel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import {
  TOOL_CHANGE_NOT_IDLE_MESSAGE,
  TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE,
  toolChangeContinueBlockMessage,
} from './laser-store-helpers';
import { respondToTestGrblBuildInfo } from './laser-test-start-helpers';
import { useStore } from './store';

const IDLE = '<Idle|MPos:10.000,20.000,-1.000|FS:0,0|Ov:100,100,100>';
const ALARM = '<Alarm|MPos:10.000,20.000,-1.000|FS:0,0>';

type Device = SerialConnection & { readonly say: (line: string) => void };

// A GRBL 1.1 stand-in: `?` answers the last status report the test said (so
// the 250 ms status poll cannot report Idle while the test holds the machine
// in Alarm, however slow a loaded runner makes the settles), `ok` for the
// settle dwell, and the unlock reply GRBL prints for `$X`.
function makeDevice(sent: string[]): Device {
  const handlers = new Set<(line: string) => void>();
  let status = IDLE;
  const device: Device = {
    write: async (data) => {
      sent.push(data);
      if (data === '?') setTimeout(() => device.say(status), 0);
      if (data === 'G4 P0.01\n') setTimeout(() => device.say('ok'), 0);
      if (data === '$X\n') {
        setTimeout(() => {
          device.say('[MSG:Caution: Unlocked]');
          device.say('ok');
        }, 0);
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
      if (line.startsWith('<')) status = line;
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
  'G0 Z5',
  'M3 S12000',
  'G1 X6 Y6 F800',
].join('\n');

async function reachHold(device: Device, seeIdle: boolean): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(device));
  device.say('Grbl 1.1f');
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
  if (seeIdle) {
    device.say(IDLE);
    await settle();
  }
}

async function say(device: Device, ...lines: string[]): Promise<void> {
  for (const line of lines) device.say(line);
  await settle();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    alarmCode: null,
    toolChangeIdleSeen: false,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('a missed touch-off probe in a drained tool-change hold', () => {
  it('keeps the job held, unlocks, and continues once the new bit is zeroed', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await reachHold(device, true);
    expect(useLaserStore.getState().toolChangeIdleSeen).toBe(true);

    await say(device, 'ALARM:5', ALARM);
    const alarmed = useLaserStore.getState();
    expect(alarmed.streamer?.status).toBe('tool-change');
    expect(alarmed.alarmCode).toBe(5);
    // Continue waits for a fresh Idle after the unlock.
    expect(alarmed.toolChangeIdleSeen).toBe(false);
    expect(toolChangeContinueBlockMessage(alarmed)).toBe(TOOL_CHANGE_NOT_IDLE_MESSAGE);

    await useLaserStore.getState().unlockAlarm();
    await settle();
    expect(sent).toContain('$X\n');
    // The acknowledgement alone does not prove the unlock (FluidNC acks `$X`
    // in its Critical state); the next report that is not Alarm clears it.
    expect(useLaserStore.getState().alarmCode).toBe(5);

    await say(device, IDLE);
    const unlocked = useLaserStore.getState();
    expect(unlocked.alarmCode).toBeNull();
    expect(unlocked.toolChangeIdleSeen).toBe(true);
    // The alarm voided the new bit's Z0: it must be zeroed again.
    expect(toolChangeContinueBlockMessage(unlocked)).toBe(TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE);
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: unlocked.workZReferenceEpoch,
        toolId: unlocked.pendingToolId ?? 'em-3175',
      },
    });

    sent.length = 0;
    await useLaserStore.getState().continueToolChange();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(sent.join('')).toContain('G0 Z5\nM3 S12000\n');
  });

  it('cancels on ALARM:4 before the hold has seen Idle', async () => {
    const device = makeDevice([]);
    await reachHold(device, false);

    await say(device, 'ALARM:4', ALARM);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });

  it('cancels on a hard-limit alarm', async () => {
    const device = makeDevice([]);
    await reachHold(device, true);

    await say(device, 'ALARM:1', ALARM);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });

  it('cancels on an Alarm report with no numbered alarm', async () => {
    const device = makeDevice([]);
    await reachHold(device, true);

    await say(device, ALARM);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });
});
