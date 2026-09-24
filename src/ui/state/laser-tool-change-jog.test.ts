// Jogging inside a CNC tool-change hold (audit drivers-2).
//
// The hold asks the operator to "jog, then Zero Z". GRBL's native jog is a
// `$J=` line, accepted while the controller is Idle
// (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging), and the streamer
// holds the M0 host-side so the controller really is Idle once the park has
// drained. safeWrite classified every `$` line as setup-only and applied the
// strict active-job gate, so the jog runJog had already admitted was refused
// on its way to the wire and touch-off was impossible without aborting.
// Everything else stays strictly refused for the whole job: Frame's own `$J=`
// lines, Home, Unlock and `$$`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer, type StreamerState } from '../../core/controllers/grbl';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import type { LaserSafetyAction } from './laser-safety-notice';
import { useLaserStore } from './laser-store';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  TOOL_CHANGE_NOT_IDLE_MESSAGE,
  jogFrameCommandBlockMessage,
} from './laser-store-helpers';
import { respondToTestGrblBuildInfo } from './laser-test-start-helpers';
import { useStore } from './store';

const IDLE = '<Idle|MPos:10.000,20.000,-1.000|FS:0,0|Ov:100,100,100>';

type Device = SerialConnection & { readonly say: (line: string) => void };

// A GRBL 1.1 stand-in: Idle on `?`, and `ok` for the settle dwell and jogs.
function makeDevice(sent: string[]): Device {
  const handlers = new Set<(line: string) => void>();
  const device: Device = {
    write: async (data) => {
      sent.push(data);
      if (data === '?') setTimeout(() => device.say(IDLE), 0);
      if (data === 'G4 P0.01\n' || data.startsWith('$J=')) setTimeout(() => device.say('ok'), 0);
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

// Two bits as the CNC emitter shapes them: cut, retract, park, load marker,
// the bare M0 the streamer holds, then the second bit's section.
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

async function holdAtToolChange(device: Device): Promise<void> {
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
  device.say(IDLE);
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
    toolChangeIdleSeen: false,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('jog during a drained, fresh-Idle CNC tool-change hold (audit drivers-2)', () => {
  it('sends the operator jog to the controller and keeps the job held', async () => {
    const sent: string[] = [];
    const device = makeDevice(sent);
    await holdAtToolChange(device);
    const held = useLaserStore.getState();
    // Preconditions: the hold drained, a fresh Idle arrived, the M0 was never
    // sent, and the store's own jog gate admits the move.
    expect(held.streamer?.status).toBe('tool-change');
    expect(held.toolChangeIdleSeen).toBe(true);
    expect(sent.some((data) => /(^|\n)M0(\n|$)/.test(data))).toBe(false);
    expect(jogFrameCommandBlockMessage(held)).toBeNull();
    const queueIndex = held.streamer?.queueIndex;

    sent.length = 0;
    await useLaserStore.getState().jog({ dz: -1, feed: 300 });
    await settle();

    expect(sent).toContain('$J=G91 G21 Z-1.000 F300\n');
    const after = useLaserStore.getState();
    expect(after.log.filter((line) => line.includes('Serial write blocked'))).toEqual([]);
    expect(after.streamer?.status).toBe('tool-change');
    expect(after.streamer?.queueIndex).toBe(queueIndex);
  });

  it('keeps Home refused for the whole job', async () => {
    const device = makeDevice([]);
    await holdAtToolChange(device);

    await expect(useLaserStore.getState().home()).rejects.toThrow();
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
  });
});

// The gate safeWrite applies to `$` lines, one action at a time.
function stateWith(streamer: StreamerState, toolChangeIdleSeen: boolean): void {
  useLaserStore.setState({ streamer, toolChangeIdleSeen });
}

function heldStreamer(): StreamerState {
  return { ...createStreamer('G0 Z5\nM0\nG0 Z5\n'), status: 'tool-change', inFlight: [] };
}

async function attempt(
  line: string,
  action: LaserSafetyAction | undefined,
): Promise<{ readonly sent: string[]; readonly refusal: string | null }> {
  const sent: string[] = [];
  const refs: SafeWriteRefs = {
    connection: {
      write: async (data) => {
        sent.push(data);
      },
      onLine: () => () => undefined,
      onClose: () => () => undefined,
      close: async () => undefined,
    },
    driver: grblDriver,
    nextTranscriptId: 1,
    writeEpoch: 0,
  };
  const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs);
  try {
    await write(line, action);
    return { sent, refusal: null };
  } catch (error) {
    return { sent, refusal: error instanceof Error ? error.message : String(error) };
  }
}

describe('safeWrite setup-line gate by declared action (audit drivers-2)', () => {
  afterEach(() => {
    useLaserStore.setState({ pendingTransportWrites: 0, pendingUntrackedAcks: 0 });
  });

  it('lets the operator jog through once the hold has drained and seen Idle', async () => {
    stateWith(heldStreamer(), true);

    expect(await attempt('$J=G91 G21 Z-1.000 F300\n', 'jog')).toEqual({
      sent: ['$J=G91 G21 Z-1.000 F300\n'],
      refusal: null,
    });
  });

  it('refuses the jog while the park may still be moving', async () => {
    stateWith(heldStreamer(), false);

    expect(await attempt('$J=G91 G21 Z-1.000 F300\n', 'jog')).toEqual({
      sent: [],
      refusal: TOOL_CHANGE_NOT_IDLE_MESSAGE,
    });
  });

  it.each<[string, LaserSafetyAction | undefined]>([
    ['$J=G90 G21 X0.000 Y0.000 F3000\n', 'frame'],
    ['$H\n', 'home'],
    ['$X\n', 'unlock'],
    ['$$\n', 'console'],
    ['$32=1\n', undefined],
  ])('keeps %j (%s) strictly refused in the same hold', async (line, action) => {
    stateWith(heldStreamer(), true);

    expect(await attempt(line, action)).toEqual({ sent: [], refusal: ACTIVE_JOB_COMMAND_MESSAGE });
  });

  it('refuses a jog while the job is streaming', async () => {
    stateWith({ ...createStreamer('G1 X1\n'), status: 'streaming' }, true);

    expect(await attempt('$J=G91 G21 X1.000 F500\n', 'jog')).toEqual({
      sent: [],
      refusal: ACTIVE_JOB_COMMAND_MESSAGE,
    });
  });
});
