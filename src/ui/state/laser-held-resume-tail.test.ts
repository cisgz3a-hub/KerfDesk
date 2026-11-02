// ADR-684 (live-loops audit LL1-P1-1): a laser Resume that grblHAL answers
// with Idle after the job's last line was sent can leave the paused move's
// tail in the controller, which runs it, at its laser power, at the next
// motion (grblHAL core issue #1024, fixed in Build 20260928). KerfDesk warns
// and blocks nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_RESUME } from '../../core/controllers/grbl';
import { RT_SAFETY_DOOR } from '../../core/controllers/grbl/commands';
import { HELD_RESUME_TAIL_MESSAGE } from '../../core/controllers/grblhal/held-resume-tail';
import type { ControllerKind } from '../../core/devices';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { currentHeldResumeTail } from './held-resume-tail';
import { useLaserStore } from './laser-store';
import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

const GCODE = 'G21\nG90\nM4 S0\nG1 X1 F600 S100\nM5';
const BANNERS: Partial<Record<ControllerKind, string>> = {
  grblhal: "GrblHAL 1.1f ['$' or '$HELP' for help]",
  'grbl-v1.1': "Grbl 1.1h ['$' for help]",
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  return {
    write: async (data) => {
      const acknowledgeFence = captureTestLaserStartFenceAck(data, emit);
      await write(data);
      acknowledgeFence?.();
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: emit,
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Runs a laser job to its acknowledged tail, pauses it, and resumes it.
 * The controller answers `~` with `resumeReport`. */
async function pauseAndResumeTail(
  controllerKind: ControllerKind,
  resumeReport: string,
): Promise<FakeConnection> {
  let stateLine = '<Run|MPos:0.400,0.000,0.000|FS:600,100|Ov:100,100,100|A:C>';
  const connection = makeConnection(async (data) => {
    if (data === RT_SAFETY_DOOR)
      stateLine = '<Door:0|MPos:0.600,0.000,0.000|FS:0,0|Ov:100,100,100>';
    if (data === RT_RESUME) stateLine = resumeReport;
    if (data === '?') connection.emitLine(stateLine);
  });
  await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind });
  connection.emitLine(BANNERS[controllerKind] ?? '');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  await flush();
  if (controllerKind === 'grbl-v1.1') {
    connection.emitLine('[VER:1.1h.20190830:test]');
    connection.emitLine('[OPT:VM,15,128]');
    connection.emitLine('ok');
    await flush();
  }
  useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
  await startTestLaserJob(GCODE);
  for (let index = 0; index < 5; index += 1) connection.emitLine('ok');
  connection.emitLine(stateLine);
  await flush();
  expect(useLaserStore.getState().streamer?.status).toBe('done');
  await useLaserStore.getState().pauseJob();
  connection.emitLine('ok');
  await flush();
  await useLaserStore.getState().resumeJob();
  return connection;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    streamer: null,
    log: [],
    controllerSettings: null,
    wcoCache: null,
    heldResumeTail: null,
  });
  vi.restoreAllMocks();
});

describe('a Resume that leaves grblHAL Idle at the end of a job', () => {
  it('warns that grblHAL may hold the paused move, until the machine moves', async () => {
    const connection = await pauseAndResumeTail('grblhal', '<Idle|MPos:0.600,0.000,0.000|FS:0,0>');

    const state = useLaserStore.getState();
    expect(currentHeldResumeTail(state)).toMatchObject({
      machinePosition: { x: 0.6, y: 0, z: 0 },
    });
    expect(state.log.some((line) => line.includes(HELD_RESUME_TAIL_MESSAGE))).toBe(true);
    // A warning only: the job still finishes and nothing is refused.
    expect(state.safetyNotice).toBeNull();

    connection.emitLine('<Idle|MPos:0.600,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.600,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(currentHeldResumeTail(useLaserStore.getState())).not.toBeNull();

    // The tail ran, so the warning retires.
    connection.emitLine('<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(currentHeldResumeTail(useLaserStore.getState())).toBeNull();
  });

  it('stays quiet when grblHAL answers Resume with Run', async () => {
    await pauseAndResumeTail(
      'grblhal',
      '<Run|MPos:0.700,0.000,0.000|FS:600,100|Ov:100,100,100|A:C>',
    );
    expect(useLaserStore.getState().heldResumeTail ?? null).toBeNull();
  });

  it('stays quiet on stock GRBL, which keeps the held block', async () => {
    await pauseAndResumeTail('grbl-v1.1', '<Idle|MPos:0.600,0.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().heldResumeTail ?? null).toBeNull();
  });
});
