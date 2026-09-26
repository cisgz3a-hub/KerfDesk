import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { respondToTestGrblBuildInfo, settleTestGrblHandshake } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(
  onWrite: (data: string, connection: FakeConnection) => void,
): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const connection: FakeConnection = {
    write: async (data) => onWrite(data, connection),
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => handlers.forEach((handler) => handler(line)),
  };
  return connection;
}

function adapter(connection: FakeConnection): PlatformAdapter {
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
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

const IDLE_STATUS = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

async function connectAndSettle(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine(IDLE_STATUS);
  await flush();
  connection.emitLine('ok');
  connection.emitLine(IDLE_STATUS);
  await settleTestGrblHandshake();
}

const THREE_AXIS_OFFSETS = ['[G54:0.000,0.000,0.000]', '[G55:4.000,5.000,-6.250]'];

function respondToWorkZQuery(
  data: string,
  connection: FakeConnection,
  beforeReply: () => void = () => undefined,
  offsetLines: ReadonlyArray<string> = THREE_AXIS_OFFSETS,
): void {
  queueMicrotask(() => {
    if (data === '$G\n') {
      beforeReply();
      connection.emitLine('[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      connection.emitLine('ok');
    }
    if (data === '$#\n') {
      beforeReply();
      for (const line of offsetLines) connection.emitLine(line);
      connection.emitLine('ok');
    }
  });
}

describe('owned controller Work-Z recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resetStore();
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useLaserStore.setState(initialLaserState());
  });

  afterEach(async () => {
    await useLaserStore
      .getState()
      .disconnect()
      .catch(() => undefined);
    useLaserStore.setState(initialLaserState());
    vi.restoreAllMocks();
  });

  // Controller audit 2026-09-25 GP-6: `$#` prints inches under `$13=1`
  // (gnea/grbl print.c printFloat_CoordValue); the evidence is in mm.
  it('stores an inch `$#` readback as millimetres when the controller reports inches', async () => {
    const connection = makeConnection((data, conn) => {
      respondToTestGrblBuildInfo(data, conn.emitLine);
      respondToWorkZQuery(data, conn, () => undefined, [
        '[G54:0.000,0.000,0.000]',
        '[G55:0.1575,0.1969,-0.2500]',
      ]);
    });
    await connectAndSettle(connection);
    useLaserStore.setState((state) => ({
      controllerSettings: { ...state.controllerSettings, reportInches: true },
    }));

    await useLaserStore.getState().recoverWorkZFromController({
      activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerOffsetRepresentsStockTop: true,
    });

    expect(useLaserStore.getState().workZZeroEvidence?.offsetZMm).toBeCloseTo(-6.35, 6);
  });

  it('owns $G and $# replies before creating tool-bound evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection((data, conn) => {
      writes.push(data);
      respondToTestGrblBuildInfo(data, conn.emitLine);
      respondToWorkZQuery(data, conn);
    });
    await connectAndSettle(connection);

    await useLaserStore.getState().recoverWorkZFromController({
      activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerOffsetRepresentsStockTop: true,
    });

    const workZReads = writes.filter((command) => command === '$G\n' || command === '$#\n');
    expect(workZReads).toEqual(['$G\n', '$#\n', '$G\n']);
    expect(writes).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(?:G0|G1|G2|G3|G10|G38|G92|\$\d+=)/i)]),
    );
    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'controller-readback',
      activeWcs: 'G55',
      offsetZMm: -6.25,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerSessionEpoch: useLaserStore.getState().controllerSessionEpoch,
    });
  });

  // grblHAL and FluidNC print every configured axis in `$#` (report.c
  // get_axis_values loops over system_n_axis()), so a rotary router answers
  // with four values per WCS. XYZ are still the first three.
  it('recovers Work Z from a 4-axis grblHAL/FluidNC `$#` report', async () => {
    const connection = makeConnection((data, conn) => {
      respondToTestGrblBuildInfo(data, conn.emitLine);
      respondToWorkZQuery(data, conn, undefined, [
        '[G54:0.000,0.000,0.000,0.000]',
        '[G55:4.000,5.000,-6.250,90.000]',
        '[G92:0.000,0.000,0.000,0.000]',
      ]);
    });
    await connectAndSettle(connection);

    await useLaserStore.getState().recoverWorkZFromController({
      activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerOffsetRepresentsStockTop: true,
    });

    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'controller-readback',
      activeWcs: 'G55',
      offsetZMm: -6.25,
    });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('writes no recovery query while the MPG already owns the controller', async () => {
    const writes: string[] = [];
    const connection = makeConnection((data, conn) => {
      writes.push(data);
      respondToTestGrblBuildInfo(data, conn.emitLine);
      respondToWorkZQuery(data, conn);
    });
    await connectAndSettle(connection);
    const recoveryWriteStart = writes.length;
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>');

    await expect(
      useLaserStore.getState().recoverWorkZFromController({
        activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
        controllerOffsetRepresentsStockTop: true,
      }),
    ).rejects.toThrow(/MPG mode active/i);

    expect(writes.slice(recoveryWriteStart)).toEqual([]);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
  });

  it.each([
    { takeoverQuery: 1, expectedReads: ['$G\n'] },
    { takeoverQuery: 2, expectedReads: ['$G\n', '$#\n'] },
    { takeoverQuery: 3, expectedReads: ['$G\n', '$#\n', '$G\n'] },
  ])(
    'publishes no Work-Z evidence when MPG takes ownership during query $takeoverQuery',
    async ({ takeoverQuery, expectedReads }) => {
      const writes: string[] = [];
      let isRecoveryActive = false;
      let recoveryQueryCount = 0;
      const connection = makeConnection((data, conn) => {
        writes.push(data);
        respondToTestGrblBuildInfo(data, conn.emitLine);
        const isRecoveryQuery = isRecoveryActive && (data === '$G\n' || data === '$#\n');
        if (isRecoveryQuery) recoveryQueryCount += 1;
        respondToWorkZQuery(data, conn, () => {
          if (isRecoveryQuery && recoveryQueryCount === takeoverQuery) {
            conn.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|MPG:1>');
          }
        });
      });
      await connectAndSettle(connection);
      const recoveryWriteStart = writes.length;
      isRecoveryActive = true;

      await expect(
        useLaserStore.getState().recoverWorkZFromController({
          activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
          controllerOffsetRepresentsStockTop: true,
        }),
      ).rejects.toThrow(/MPG mode active/i);

      const recoveryReads = writes
        .slice(recoveryWriteStart)
        .filter((command) => command === '$G\n' || command === '$#\n');
      expect(recoveryReads).toEqual(expectedReads);
      expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
      expect(useLaserStore.getState().lastWriteError).toMatch(/MPG mode active/i);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
    },
  );
});
