// Controller audit 2 (ADR-375), C-4: a Console `$n=` write on stock GRBL. The
// firmware truncates an integer setting's value into 8 bits and still answers
// `ok` (grbl/settings.c#L229), so such a value is refused before anything is
// written, and every acknowledged write is read back with `$$` so the settings
// table shows what the controller actually stored.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { useLaserStore, type LaserState } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeAdapter,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';

async function connectedIdle(
  onWrite?: (data: string) => void,
): Promise<{ connection: FakeConnection; wire: string[] }> {
  const wire: string[] = [];
  const connection = makeConnection(
    async (data) => {
      wire.push(data);
      onWrite?.(data);
    },
    { autoRespondToStatusQuery: true },
  );
  await connectWith(connection);
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushConnect();
  wire.length = 0;
  return { connection, wire };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerOperation: null,
    lastWriteError: null,
    log: [],
    transcript: [],
    grblSettingsRows: [],
  });
  vi.restoreAllMocks();
});

describe('Console setting writes on stock GRBL', () => {
  it.each([
    ['$22=0.5', /0\.5 would turn it off/],
    ['$1=300', /whole number from 0 to 255/],
  ])('refuses %s before writing anything', async (command, reason) => {
    const { wire } = await connectedIdle();

    await expect(
      useLaserStore.getState().sendConsoleCommand(command, { confirmed: true }),
    ).rejects.toThrow(reason);
    expect(wire.filter((data) => data !== '?')).toEqual([]);
  });

  it('reads the settings back after an acknowledged write', async () => {
    const { connection, wire } = await connectedIdle();

    const sent = useLaserStore.getState().sendConsoleCommand('$1=25', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$1=25\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    for (const line of ['$1=25', '$22=1', 'ok']) connection.emitLine(line);
    await sent;

    const rows = useLaserStore.getState().grblSettingsRows;
    expect(rows.find((row) => row.id === 1)?.rawValue).toBe('25');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('keeps an acknowledged write and says so when the read-back fails', async () => {
    const { connection, wire } = await connectedIdle();
    seedControllerEvidence();

    const sent = useLaserStore.getState().sendConsoleCommand('$1=25', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$1=25\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    connection.emitLine('error:8');
    await sent;

    expect(useLaserStore.getState().log.join('\n')).toContain(
      'The controller acknowledged $1=25, but reading its settings back failed',
    );
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
  });

  it.each([
    ['$100=160', 'position'],
    ['$13=1', 'report-units'],
    ['$30=2000', 'process'],
  ])('retires old evidence before an uncertain Console %s write', async (command, effect) => {
    let atDispatch: LaserState | undefined;
    await connectedIdle((data) => {
      if (data !== `${command}\n`) return;
      atDispatch = useLaserStore.getState();
      throw new Error('The transport result is unknown.');
    });
    const before = seedControllerEvidence();

    await expect(
      useLaserStore.getState().sendConsoleCommand(command, { confirmed: true }),
    ).rejects.toThrow('The transport result is unknown.');

    expect(atDispatch).toMatchObject({
      controllerSettings: { reportInches: false },
      controllerSettingsObservation: null,
      detectedSettings: null,
      grblSettingsRows: [],
      lastSettingsReadAt: null,
    });
    const after = useLaserStore.getState();
    expect(after.controllerQualification.kind).toBe('failed');
    if (effect === 'position') {
      expect(atDispatch).toMatchObject({
        frameVerification: null,
        homingProof: null,
        homingState: 'unknown',
        workZZeroEvidence: null,
        statusReport: null,
        wcoCache: null,
        trustedPositionEpoch: (before.trustedPositionEpoch ?? 0) + 1,
        workZReferenceEpoch: before.workZReferenceEpoch + 1,
      });
    } else if (effect === 'report-units') {
      expect(atDispatch).toMatchObject({
        reportUnitsUnconfirmed: true,
        frameVerification: null,
        statusReport: null,
        wcoCache: null,
      });
    } else {
      expect(atDispatch?.frameVerification).toBe(before.frameVerification);
      expect(atDispatch?.homingProof).toBe(before.homingProof);
      expect(atDispatch?.workZZeroEvidence).toBe(before.workZZeroEvidence);
    }
  });

  it('does not leave qualification pending after an empty setting read-back', async () => {
    const { connection, wire } = await connectedIdle();
    seedControllerEvidence();

    const sent = useLaserStore.getState().sendConsoleCommand('$30=2000', { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain('$30=2000\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    connection.emitLine('ok');
    await sent;

    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('response was empty'),
    });
  });
});

// Controller audit v2 C4-P2-1 (ADR-375 Amendment 4): grblHAL keeps only the
// number at the start of a `$N=` value and answers ok (core d7aaee3
// settings.c#L3527-L3552), so the store refuses such a value before writing
// and compares the `$$` re-read with what was typed.
describe('Console setting writes on grblHAL', () => {
  async function connectedGrblHalIdle(): Promise<{ connection: FakeConnection; wire: string[] }> {
    const wire: string[] = [];
    const connection = makeConnection(
      async (data) => {
        wire.push(data);
      },
      { autoRespondToStatusQuery: true },
    );
    await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind: 'grblhal' });
    connection.emitLine("GrblHAL 1.1f ['$' or '$HELP' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    connection.emitLine('ok');
    await flushConnect();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    wire.length = 0;
    return { connection, wire };
  }

  async function writeAndReread(command: string, dump: ReadonlyArray<string>): Promise<void> {
    const { connection, wire } = await connectedGrblHalIdle();
    const sent = useLaserStore.getState().sendConsoleCommand(command, { confirmed: true });
    await vi.waitFor(() => expect(wire).toContain(`${command}\n`));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(wire).toContain('$$\n'));
    for (const line of [...dump, 'ok']) connection.emitLine(line);
    await sent;
  }

  it.each([
    ['$100=26,67', /cannot be sent: Enter a finite decimal number/],
    ['$22=1.0', /Send \$22=1 instead/],
  ])('refuses %s before writing anything', async (command, reason) => {
    const { wire } = await connectedGrblHalIdle();

    await expect(
      useLaserStore.getState().sendConsoleCommand(command, { confirmed: true }),
    ).rejects.toThrow(reason);
    expect(wire.filter((data) => data !== '?')).toEqual([]);
  });

  it('says so when the re-read shows a different value than the one typed', async () => {
    await writeAndReread('$680=25.0', ['$22=1', '$680=250', '$384=0']);

    const state = useLaserStore.getState();
    const message =
      'The controller reports $680=250 after the re-read, not 25.0: it stored a different value.';
    expect(state.lastWriteError).toContain(message);
    // The Console shows the transcript, not the plain log.
    expect(state.transcript.some((entry) => entry.raw.includes(message))).toBe(true);
    expect(state.grblSettingsRows.find((row) => row.id === 680)?.rawValue).toBe('250');
  });

  it('stays quiet when the re-read shows the typed value', async () => {
    await writeAndReread('$110=5000.5', ['$22=1', '$110=5000.500', '$384=0']);

    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(useLaserStore.getState().log.join('\n')).not.toContain('after the re-read');
  });
});

function seedControllerEvidence(): LaserState {
  const state = useLaserStore.getState();
  useLaserStore.setState({
    controllerSettings: { reportInches: false, maxPowerS: 1000, stepsPerMmX: 80 },
    controllerSettingsObservation: {
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: Date.now(),
    },
    controllerQualification: {
      kind: 'qualified',
      epoch: state.controllerSessionEpoch,
      settings: 'verified',
    },
    detectedSettings: { maxPowerS: 1000 },
    grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
    lastSettingsReadAt: Date.now(),
    homingState: 'confirmed',
    homingProof: {
      sessionEpoch: state.controllerSessionEpoch,
      positionEpoch: state.trustedPositionEpoch ?? 0,
      confirmedStatusSequence: state.statusSequence,
    },
    wcoCache: { x: 0, y: 0, z: 0 },
    workOriginActive: true,
    workOriginSource: 'g54-persistent',
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: state.workZReferenceEpoch },
    frameVerification: {
      boundsSignature: 'completed-machine-footprint',
      wco: { x: 0, y: 0, z: 0 },
      workOriginActive: true,
    },
  });
  return useLaserStore.getState();
}
