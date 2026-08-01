import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

// Minimal serial harness (mirrors laser-store-motion-operation.test.ts).
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

// Hardware-realistic settlement: GRBL acks $J= at parse time (ok first, while
// status still reports Jog); the G4 settlement marker may only follow a fresh
// Idle report, and one final Idle confirmation releases the XY traverse.
async function settleCncRetract(
  connection: FakeConnection,
  writes: ReadonlyArray<string>,
): Promise<void> {
  connection.emitLine('ok');
  await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(1));
  expect(writes).not.toContain('G4 P0.01\n');

  connection.emitLine('<Jog|MPos:50.000,30.000,3.810|FS:1000,0>');
  await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(2));
  expect(writes).not.toContain('G4 P0.01\n');

  connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
  await vi.waitFor(() => expect(writes).toContain('G4 P0.01\n'));
  expect(writes.some((line) => line.includes('X70.000'))).toBe(false);

  connection.emitLine('ok');
  await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(3));
  expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
  connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
  await flush();
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

describe('jogToMachinePosition', () => {
  it('jogs the relative delta from the current machine position', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    // Head at machine (50,30); target the board corner at machine (120,80).
    await useLaserStore.getState().jogToMachinePosition(120, 80, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('reaches the (0,0) origin corner from a nonzero position', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:40.000,25.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(0, 0, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X-40.000 Y-25.000 F1000\n',
    ]);
  });

  it('does nothing when already at the target', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(12, 34, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([]);
  });

  it('lifts Z to the CNC safe height before the XY traverse, then jogs (F105)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    const machine = useStore.getState().project.machine;
    const safeZMm = machine?.kind === 'cnc' ? machine.params.safeZMm : 0;
    const state = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
    });
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    const move = useLaserStore.getState().jogToMachinePosition(120, 80, 1000);
    await flush();

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      `$J=G90 G21 Z${safeZMm.toFixed(3)} F1000\n`,
    ]);
    await settleCncRetract(connection, writes);
    await move;

    // The XY traverse is withheld until the safe-Z retract crosses the owned
    // planner marker and a later Idle report proves physical clearance.
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      `$J=G90 G21 Z${safeZMm.toFixed(3)} F1000\n`,
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('writes nothing when a CNC point move lacks current Work-Z evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    await expect(useLaserStore.getState().jogToMachinePosition(120, 80, 1000)).rejects.toThrow(
      /work z/i,
    );

    expect(writes).toEqual([]);
  });

  it('does not add a Z retract for a laser project', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(120, 80, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('retains a cancelled owner when the CNC safe-Z retract rejects ambiguously', async () => {
    let rejectRetract = false;
    const connection = makeConnection(async (data) => {
      if (rejectRetract && data.startsWith('$J=G90 G21 Z')) {
        throw new Error('safe-Z transport rejected');
      }
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    const state = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
    });
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    rejectRetract = true;

    await expect(useLaserStore.getState().jogToMachinePosition(120, 80, 1000)).rejects.toThrow(
      'safe-Z transport rejected',
    );

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'jog',
      cancelRequested: true,
    });
    connection.emitLine('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
  });

  it('never dispatches XY or its settle marker before a delayed safe-Z handoff resolves', async () => {
    let releaseRetract!: () => void;
    let holdRetract = false;
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (holdRetract && data.startsWith('$J=G90 G21 Z')) {
        await new Promise<void>((resolve) => {
          releaseRetract = resolve;
        });
      }
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    const state = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
    });
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;
    holdRetract = true;

    const move = useLaserStore.getState().jogToMachinePosition(120, 80, 1000);
    await flush();
    connection.emitLine('<Jog|MPos:50.000,30.000,3.810|FS:1000,0>');
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
    connection.emitLine('ok');
    await flush();

    expect(writes).toEqual(['$J=G90 G21 Z3.810 F1000\n']);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'jog',
      dispatchComplete: false,
    });

    releaseRetract();
    // The stale pre-release Idle is not fresh proof: the fence must probe
    // status and observe a new Idle before crossing the settlement marker.
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(1));
    expect(writes).not.toContain('G4 P0.01\n');
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
    await vi.waitFor(() => expect(writes).toContain('G4 P0.01\n'));
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
    connection.emitLine('ok');
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(2));
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
    await move;
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 Z3.810 F1000\n',
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('cancels the point move when MPG takes control during safe-Z settlement', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    const state = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
      mpgActive: false,
    });
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0|MPG:0>');
    writes.length = 0;

    const outcome = useLaserStore
      .getState()
      .jogToMachinePosition(120, 80, 1000)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await flush();
    connection.emitLine('ok');
    // The pre-marker Idle fence is probing status when the pendant takes over.
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(1));
    connection.emitLine('<Idle|MPos:55.000,35.000,1.000|FS:0,0|MPG:1>');

    expect(await outcome).toBeInstanceOf(Error);
    expect(writes).not.toContain('G4 P0.01\n');
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'jog',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
  });

  it('lets Cancel supersede an in-progress safe-Z status proof and settle the owner', async () => {
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

    const moveOutcome = useLaserStore
      .getState()
      .jogToMachinePosition(120, 80, 1000)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await flush();
    connection.emitLine('ok');
    // The retract's pre-marker Idle fence has its first status probe in flight.
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(1));

    const cancel = useLaserStore.getState().cancelJog();
    await vi.waitFor(() => expect(writes.filter((line) => line === RT_JOG_CANCEL)).toHaveLength(1));
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(2));

    // A cancel sent during the command-to-Jog transition is not sufficient:
    // the hardened fence observes Jog, re-sends 0x85, and asks again.
    connection.emitLine('<Jog|MPos:50.000,30.000,3.810|FS:1000,0>');
    await vi.waitFor(() => expect(writes.filter((line) => line === RT_JOG_CANCEL)).toHaveLength(2));
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(3));

    // Only a fresh Idle may put the cancellation marker behind the stopped
    // motion queue. The marker ack is then followed by one final Idle proof.
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');
    await vi.waitFor(() => expect(writes.filter((line) => line === 'G4 P0.01\n')).toHaveLength(1));
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
    connection.emitLine('ok');
    await vi.waitFor(() => expect(statusProbeCount(writes)).toBeGreaterThanOrEqual(4));
    connection.emitLine('<Idle|MPos:50.000,30.000,3.810|FS:0,0>');

    await cancel;
    expect(await moveOutcome).toBeInstanceOf(Error);
    expect(writes.some((line) => line.includes('X70.000'))).toBe(false);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('errors without a live machine position', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({ statusReport: null, statusObservation: null });
    // No status report emitted → no known position.

    await expect(useLaserStore.getState().jogToMachinePosition(10, 10, 1000)).rejects.toThrow(
      /live machine position/i,
    );
    expect(useLaserStore.getState().lastWriteError).toMatch(/live machine position/i);
  });
});

function statusProbeCount(writes: ReadonlyArray<string>): number {
  return writes.filter((line) => line === '?').length;
}
