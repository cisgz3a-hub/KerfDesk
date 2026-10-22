// A CNC tool-change hold re-zeroes Z only (controller audit v2 C2-P1-1,
// ADR-375 Amendment 3). The XYZ corner probe ends in G92.1 and
// G10 L20 P0 X Y Z, and Set origin writes G92 X Y, so either one run in the
// hold moved the X/Y origin and Continue then cut the rest of the job there.
// Driven through the real store with a fake GRBL 1.1 controller, as the
// audit's repro did.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
  type ProbeRequest,
} from '../../core/controllers/grbl/probe';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import {
  TOOL_CHANGE_XY_ORIGIN_MESSAGE,
  toolChangeContinueBlockMessage,
} from './laser-store-helpers';
import { respondToTestGrblBuildInfo } from './laser-test-start-helpers';
import { useStore } from './store';

const IDLE = '<Idle|MPos:10.000,20.000,-1.000|FS:0,0|Ov:100,100,100>';
const RUN = '<Run|MPos:10.000,20.000,-1.000|FS:800,0|Ov:100,100,100>';

const CORNER_REQUEST = {
  kind: 'corner',
  params: {
    ...DEFAULT_Z_PROBE_PARAMS,
    bitDiameterMm: 3.176,
    toolKind: 'end-mill',
    corner: 'front-left',
    plateCenterOffsetXmm: DEFAULT_PLATE_CENTER_OFFSET_X_MM,
    plateCenterOffsetYmm: DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
    sideDropMm: DEFAULT_SIDE_DROP_MM,
    sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
  },
} satisfies ProbeRequest;
const Z_REQUEST = { kind: 'z', params: DEFAULT_Z_PROBE_PARAMS } satisfies ProbeRequest;

type Device = SerialConnection & {
  readonly say: (line: string) => void;
  /** From now on every line is acknowledged, as GRBL does once Idle. */
  readonly ackEveryLine: () => void;
};

// A GRBL 1.1 stand-in. Until `ackEveryLine`, job lines wait for the test's
// `ok` and switch the reported state to Run, so the hold drains as on a real
// controller; `?` answers the last state reported.
function makeDevice(sent: string[]): Device {
  const handlers = new Set<(line: string) => void>();
  let status = IDLE;
  let ackAll = false;
  const device: Device = {
    write: async (data) => {
      sent.push(data);
      if (data === '?') {
        setTimeout(() => device.say(status), 0);
        return;
      }
      if (ackAll && data.endsWith('\n')) {
        setTimeout(() => device.say('ok'), 0);
        return;
      }
      if (/^G[01]\b/m.test(data)) status = RUN;
      if (data === 'G4 P0.01\n') setTimeout(() => device.say('ok'), 0);
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
    ackEveryLine: () => {
      ackAll = true;
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

/** Starts the two-bit job and drains it into a hold that has seen Idle. */
async function reachDrainedHold(device: Device): Promise<void> {
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
  device.say(RUN);
  while ((useLaserStore.getState().streamer?.inFlight.length ?? 0) > 0) {
    device.say('ok');
    await settle(0);
  }
  device.say(IDLE);
  await settle();
  expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
  expect(useLaserStore.getState().toolChangeIdleSeen).toBe(true);
}

/** Runs a probe, reporting Idle until it settles (it needs two fresh reports). */
async function probeAtIdle(device: Device, request: ProbeRequest): Promise<unknown> {
  let result: unknown = undefined;
  const pending = useLaserStore
    .getState()
    .probe(request)
    .then((value) => {
      result = value;
    });
  for (let i = 0; i < 100 && result === undefined; i += 1) {
    device.say(IDLE);
    await settle();
  }
  await pending;
  return result;
}

// G92.1 drops a G92 X/Y; a G92 or G10 naming X or Y writes one. The Z probe's
// own `G10 L20 P0 Z…` is the Z-only write the hold is for.
const XY_ORIGIN_WRITE = /G92\.1|G92[^\n]*[XY]|G10[^\n]*[XY]/;

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
    lastWriteError: null,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('X/Y origin writers in a CNC tool-change hold', () => {
  it('refuses the corner probe, and Continue runs the rest of the job on the original origin', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await reachDrainedHold(device);
    const before = useLaserStore.getState();
    device.ackEveryLine();
    sent.length = 0;

    await expect(probeAtIdle(device, CORNER_REQUEST)).resolves.toEqual({
      kind: 'preflight-failed',
      reason: TOOL_CHANGE_XY_ORIGIN_MESSAGE,
    });
    expect(sent.filter((line) => line !== '?')).toEqual([]);
    expect(useLaserStore.getState()).toMatchObject({
      workOriginVersion: before.workOriginVersion,
      workOriginSource: before.workOriginSource,
      streamer: { status: 'tool-change' },
    });

    // The Z touch-off is what the hold is for.
    await expect(probeAtIdle(device, Z_REQUEST)).resolves.toEqual({ kind: 'ok' });
    useLaserStore.getState().confirmProbePlateRemoved();
    const probed = useLaserStore.getState();
    if (probed.pendingToolId !== null && probed.workZZeroEvidence !== null) {
      // The test project has no CNC bit list, so name the bit the hold waits for.
      useLaserStore.setState({
        workZZeroEvidence: { ...probed.workZZeroEvidence, toolId: probed.pendingToolId },
      });
    }
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).toBeNull();
    expect(useLaserStore.getState().workOriginVersion).toBe(before.workOriginVersion);

    await useLaserStore.getState().continueToolChange();
    await settle();
    expect(sent.join('')).toContain('G0 Z5\nM3 S12000\n');
    expect(sent.join('')).toContain('G1 X6 Y6 F800');
    expect(sent.some((line) => XY_ORIGIN_WRITE.test(line))).toBe(false);
    expect(useLaserStore.getState().workOriginVersion).toBe(before.workOriginVersion);
  });

  it.each([
    ['Set origin', 'setOriginHere'],
    ['Reset origin', 'resetOrigin'],
    ['Set persistent origin', 'setPersistentOriginHere'],
  ] as const)('refuses %s and sends nothing', async (_label, action) => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await reachDrainedHold(device);
    device.ackEveryLine();
    sent.length = 0;

    // The phone remote's set_work_origin (X/Y) calls this same store action.
    await expect(useLaserStore.getState()[action]()).rejects.toThrow(TOOL_CHANGE_XY_ORIGIN_MESSAGE);
    expect(sent.filter((line) => line !== '?')).toEqual([]);
    expect(useLaserStore.getState()).toMatchObject({
      lastWriteError: TOOL_CHANGE_XY_ORIGIN_MESSAGE,
      streamer: { status: 'tool-change' },
    });
  });

  it('still lets Zero Z re-zero the new bit', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await reachDrainedHold(device);
    device.ackEveryLine();
    sent.length = 0;

    const zeroing = useLaserStore.getState().zeroZHere();
    for (let i = 0; i < 20; i += 1) {
      device.say(IDLE);
      await settle();
    }
    await zeroing;
    expect(sent).toContain('G54 G92 Z0\n');
    expect(useLaserStore.getState().workZZeroEvidence?.source).toBe('manual-zero');
  });
});
