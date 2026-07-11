// CNC-01..03 activation — a multi-tool CNC job holds at the M0 (never sent),
// and continueToolChange resumes it. A laser job's M0 streams through. Drives
// the real store over a fake serial port, the same path the app takes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createProject } from '../../core/scene';
import { useStore } from './store';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      writes.push(data);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
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
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

// pre-M0 section, M0 boundary, spin-up + second section.
const CNC_MULTI_TOOL = [
  'G1 X1 Y1 F600',
  'G0 Z5',
  'M5',
  'G0 X0 Y0',
  'M0',
  'M3 S12000',
  'G1 X2 Y2',
].join('\n');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('CNC tool-change activation (CNC-01..03)', () => {
  it('holds a CNC job at the M0 without sending it, then continueToolChange resumes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    writes.length = 0;
    await useLaserStore.getState().startJob(CNC_MULTI_TOOL, { machineKind: 'cnc' });

    // The pre-M0 lines went out; the M0 did NOT, and the stream is held.
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    expect(writes.join('')).toContain('G0 X0 Y0');
    expect(writes.join('')).not.toContain('M0');

    // Continue is refused until the pre-M0 retract drains to a FRESH Idle — the
    // resumed spindle/cutting must not queue behind still-moving motion, and the
    // machine must have actually reached the tool-change position (Codex audit P1).
    writes.length = 0;
    await useLaserStore.getState().continueToolChange();
    expect(writes.join('')).toBe('');
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');

    // Drain the tail with acks, then observe a fresh Idle → the hold is ready.
    while ((useLaserStore.getState().streamer?.inFlight.length ?? 0) > 0) {
      connection.emitLine('ok');
      await flush();
    }
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    writes.length = 0;
    await useLaserStore.getState().continueToolChange();

    // The M0 is dropped and the emitter's spin-up is fed next.
    expect(writes.join('')).toContain('M3 S12000');
    expect(useLaserStore.getState().streamer?.status).not.toBe('tool-change');
  });

  it('streams a laser job M0 through as an ordinary program stop', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);

    writes.length = 0;
    await useLaserStore.getState().startJob('G1 X1 Y1 S100\nM0\nG1 X2 Y2 S100\n', {
      machineKind: 'laser',
    });

    expect(useLaserStore.getState().streamer?.status).not.toBe('tool-change');
    expect(writes.join('')).toContain('M0');
  });
});
