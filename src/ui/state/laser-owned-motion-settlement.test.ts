import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

// Minimal serial harness (mirrors laser-store-jog-to-point.test.ts).
type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      respondToTestGrblHandshake(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
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
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  await settleTestGrblHandshake();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useStore.getState().setMachineKind('laser');
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
    motionOperation: null,
    workZZeroEvidence: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('settleOwnedMotionPhase Idle fence (G4-during-Jog regression)', () => {
  // Hardware-realistic ordering: GRBL acknowledges a $J= jog at PARSE time,
  // while the machine is still physically moving and the controller keeps
  // reporting <Jog>. The G4 settlement marker must not go on the wire until a
  // fresh Idle status has been observed after that ack — GRBL rejects G4
  // during Jog. Mirrors the ADR-231 §4 cancel-path fence.
  it('holds the settlement marker until a fresh Idle follows the parse-time jog ack', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    const state = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
    });
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    const move = useLaserStore.getState().jogToMachinePosition(120, 80, 1000);
    await flush();
    expect(writes.filter((line) => line.startsWith('$J='))).toHaveLength(1);

    // The retract's ok arrives immediately (parse-time ack); no status report
    // has claimed the controller left Jog yet.
    connection.emitLine('ok');
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(1));
    expect(writes).not.toContain('G4 P0.01\n');
    await vi.waitFor(() =>
      expect(writes.filter((line) => line === '?').length).toBeGreaterThanOrEqual(1),
    );

    // The controller stays in Jog for a while: still no marker.
    connection.emitLine('<Jog|MPos:50.000,30.000,2.000|FS:1000,0>');
    await vi.waitFor(() =>
      expect(writes.filter((line) => line === '?').length).toBeGreaterThanOrEqual(2),
    );
    expect(writes).not.toContain('G4 P0.01\n');

    // Only a fresh Idle report opens the settlement marker.
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
    await vi.waitFor(() => expect(writes).toContain('G4 P0.01\n'));
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);

    connection.emitLine('ok');
    await vi.waitFor(() =>
      expect(writes.filter((line) => line === '?').length).toBeGreaterThanOrEqual(3),
    );
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
    await move;

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      expect.stringMatching(/^\$J=G90 G21 Z/) as unknown as string,
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });
});
