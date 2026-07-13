import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCornerProbeLines,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
} from '../../core/controllers/grbl';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly listenerCount: () => number;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    listenerCount: () => lineHandlers.size,
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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function manualWorkZEvidence() {
  return {
    source: 'manual-zero' as const,
    referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (useLaserStore.getState().connection.kind !== 'disconnected') {
    await useLaserStore.getState().disconnect();
  }
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    probeBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    workZZeroEvidence: null,
    log: [],
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('probe controller transaction lifecycle', () => {
  it('owns every ack and remains busy through the settle marker and stable Idle', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    useStore.setState({
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
    });

    let resolved = false;
    const probe = useLaserStore
      .getState()
      .probe(['G21', 'G90', 'G0 Z5'])
      .then((result) => {
        resolved = true;
        return result;
      });
    await flush();
    // The evidence binds to the cutter selected when probing began; a project
    // edit while the physical transaction is in flight cannot relabel it.
    useStore.getState().updateCncMachine({ toolId: 'em-6350' });

    expect(writes).toEqual(['G21\n']);
    expect(connection.listenerCount()).toBe(1);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'sequence',
    });
    expect(useLaserStore.getState().probeBusy).toBe(true);
    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(
      /controller operation/i,
    );
    await expect(useLaserStore.getState().startJob('G21\nG90\nM5\n')).rejects.toThrow(
      /controller operation/i,
    );

    connection.emitLine('ok');
    await flush();
    expect(writes.at(-1)).toBe('G90\n');
    connection.emitLine('ok');
    await flush();
    expect(writes.at(-1)).toBe('G0 Z5\n');
    connection.emitLine('ok');
    await flush();
    expect(writes.at(-1)).toBe('G4 P0.01\n');
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'settling',
    });

    // An Idle report before the FIFO fence acknowledges is not completion.
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    expect(resolved).toBe(false);
    connection.emitLine('ok');
    await flush();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'awaiting-idle',
    });

    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    await flush();
    expect(resolved).toBe(false);
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    await expect(probe).resolves.toEqual({ kind: 'ok' });

    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toEqual({
      source: 'probe',
      referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
      toolId: 'em-3175',
      probePlateRemoved: false,
    });
    useLaserStore.getState().confirmProbePlateRemoved();
    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'probe',
      probePlateRemoved: true,
    });
    expect(useLaserStore.getState().log.at(-1)).toContain('touch plate');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('maps a probe alarm, invalidates setup evidence, and releases acknowledgement ownership', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({ workZZeroEvidence: manualWorkZEvidence() });

    const probe = useLaserStore.getState().probe(['G38.2 Z-25.000 F150.000']);
    await flush();
    connection.emitLine('ALARM:5');

    await expect(probe).resolves.toEqual({ kind: 'probe-failed', alarmCode: 5 });
    expect(writes).toEqual(['G38.2 Z-25.000 F150.000\n']);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().alarmCode).toBe(5);
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
  });

  it('does not write a partial corner WCS when the final side contact fails', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const lines = buildCornerProbeLines({
      ...DEFAULT_Z_PROBE_PARAMS,
      bitDiameterMm: 6.35,
      corner: 'front-left',
      sideDropMm: DEFAULT_SIDE_DROP_MM,
      sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
    });
    const lastProbeLine = lines.filter((line) => line.startsWith('G38.2')).at(-1);
    if (lastProbeLine === undefined) throw new Error('corner probe line missing');

    const probe = useLaserStore.getState().probe(lines);
    await flush();
    for (const line of lines) {
      expect(writes.at(-1)).toBe(`${line}\n`);
      if (line === lastProbeLine) {
        connection.emitLine('ALARM:5');
        break;
      }
      connection.emitLine('ok');
      await flush();
    }

    await expect(probe).resolves.toEqual({ kind: 'probe-failed', alarmCode: 5 });
    expect(writes.some((line) => line.startsWith('G10 L20'))).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().statusReport).toBeNull();
  });

  it('aborts on a status-only Alarm even when no numbered ALARM line arrives', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({ workZZeroEvidence: manualWorkZEvidence() });

    const probe = useLaserStore.getState().probe(['G38.2 Z-25.000 F150.000']);
    await flush();
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');

    await expect(probe).resolves.toEqual({ kind: 'alarm', alarmCode: null });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
  });

  it('treats a port close during probing as an unsafe active disconnect', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const probe = useLaserStore.getState().probe(['G38.2 Z-25.000 F150.000']);
    await flush();
    connection.emitClose();

    await expect(probe).resolves.toMatchObject({ kind: 'preflight-failed' });
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('disconnect-during-job');
  });

  it('invalidates setup evidence and surfaces a probe-specific notice when a write fails', async () => {
    let failWrites = false;
    const connection = makeConnection(async () => {
      if (failWrites) throw new Error('probe write failed');
    });
    await connectWith(connection);
    useLaserStore.setState({ workZZeroEvidence: manualWorkZEvidence() });
    failWrites = true;

    await expect(
      useLaserStore.getState().probe(['G38.2 Z-25.000 F150.000']),
    ).resolves.toMatchObject({ kind: 'preflight-failed' });

    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'probe',
    });
  });

  it('soft-resets and emits controller shutdown lines before a commanded disconnect', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const probe = useLaserStore.getState().probe(['G38.2 Z-25.000 F150.000']);
    await flush();
    await useLaserStore.getState().disconnect();

    await expect(probe).resolves.toMatchObject({ kind: 'preflight-failed' });
    expect(writes[0]).toBe('G38.2 Z-25.000 F150.000\n');
    expect(writes).toContain('\x18');
    expect(writes).toContain('M9\n');
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
  });
});
