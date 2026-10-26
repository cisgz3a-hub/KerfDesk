// Controller audit 2 (ADR-375), C-4: a Console `$n=` write on stock GRBL. The
// firmware truncates an integer setting's value into 8 bits and still answers
// `ok` (grbl/settings.c#L229), so such a value is refused before anything is
// written, and every acknowledged write is read back with `$$` so the settings
// table shows what the controller actually stored.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGrblSimSettings } from '../../__fixtures__/controllers/grbl-sim-settings';
import {
  GRBLHAL_LEVEL_1_GRBL_BANNER_DUMP,
  grblHalSettingsMap,
} from '../../__fixtures__/controllers/grblhal-settings-dump';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { useLaserStore, type LaserState } from './laser-store';
import { laserStatusReportFieldsOff } from './status-report-fields';
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

// Controller audit v2 C4-P2-1 (ADR-375 Amendment 3): grblHAL keeps only the
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

// Meta audit v1 M3-P3-3 (ADR-375 Amendment 4). Connect binds the driver from
// the profile, and Ortur's ESP32-S2 grblHAL firmware (COMPATIBILITY_LEVEL 1, no
// preset) greets as "Grbl 1.1f", so it runs under the default stock-GRBL
// profile. Both fakes below sit behind that profile. The grblHAL one stores
// the number read_float finds at the start of a value and answers ok (Ortur
// settings.c#L456-L472, nuts_bolts.c#L152-L209); stock GRBL answers error:3
// when anything follows the number (gnea/grbl system.c#L269-L270).
describe('Console setting writes behind the default stock-GRBL profile', () => {
  type FakeFirmware = {
    readonly buildInfo: ReadonlyArray<string>;
    readonly settings: Map<number, string>;
    /** The text `$$` prints after storing `typed`, or null to refuse it. */
    readonly parse: (typed: string, previous: string) => string | null;
  };

  const leadingNumber = (typed: string): number | null => {
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(typed);
    return match === null ? null : Number(match[0]);
  };
  // `$$` prints each decimal setting to the places it already shows.
  const printedLike = (previous: string, value: number): string =>
    value.toFixed(/\.(\d+)$/.exec(previous)?.[1]?.length ?? 0);

  const grblHalLevel1 = (dump: ReadonlyArray<string>): FakeFirmware => ({
    buildInfo: ['[VER:1.1f(ESP32).20210403:]', '[OPT:VNMHSL,35,16384,3]'],
    settings: grblHalSettingsMap({}, dump),
    parse: (typed, previous) => {
      const value = leadingNumber(typed);
      return value === null ? null : printedLike(previous, value);
    },
  });
  const stockGrbl = (): FakeFirmware => ({
    buildInfo: ['[VER:1.1f.20170801:]', '[OPT:V,15,128]'],
    settings: defaultGrblSimSettings(),
    parse: (typed, previous) =>
      /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(typed) ? printedLike(previous, Number(typed)) : null,
  });

  function fakeController(firmware: FakeFirmware, wire: string[]): FakeConnection {
    const handlers = new Set<(line: string) => void>();
    const emit = (line: string): void => {
      for (const handler of handlers) handler(line);
    };
    const answer = (line: string): void => {
      if (line === '$$') {
        for (const [id, value] of firmware.settings) emit(`$${id}=${value}`);
      } else if (line === '$I') {
        firmware.buildInfo.forEach(emit);
      } else if (line === '$G') {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      } else {
        const write = /^\$(\d+)=(.*)$/.exec(line);
        const id = Number(write?.[1]);
        const stored = firmware.parse(write?.[2] ?? '', firmware.settings.get(id) ?? '0');
        if (stored === null) {
          emit('error:3');
          return;
        }
        firmware.settings.set(id, stored);
      }
      emit('ok');
    };
    return {
      write: async (data) => {
        wire.push(data);
        if (data === '?') {
          queueMicrotask(() => {
            queueMicrotask(() => emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>'));
          });
        } else if (data.endsWith('\n')) {
          answer(data.slice(0, -1));
        }
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

  async function connectedBehindGrblProfile(firmware: FakeFirmware): Promise<string[]> {
    const wire: string[] = [];
    const connection = fakeController(firmware, wire);
    await useLaserStore.getState().connect(makeAdapter(connection));
    connection.emitLine("Grbl 1.1f ['$' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
    expect(useLaserStore.getState().activeControllerKind).toBe('grbl-v1.1');
    wire.length = 0;
    return wire;
  }

  it('refuses a value the grblHAL board would keep only in part, before writing it', async () => {
    const wire = await connectedBehindGrblProfile(grblHalLevel1(GRBLHAL_LEVEL_1_GRBL_BANNER_DUMP));
    expect(useLaserStore.getState().controllerSettings?.listsGrblHalSignalSettings).toBe(true);

    await expect(
      useLaserStore.getState().sendConsoleCommand('$100=26,67', { confirmed: true }),
    ).rejects.toThrow(
      /keeps only the number at the start .*The profile selects GRBL v1\.1, but this controller lists grblHAL's \$14-\$18/,
    );
    expect(wire.filter((data) => data !== '?')).toEqual([]);
    expect(useLaserStore.getState().grblSettingsRows.find((row) => row.id === 100)?.rawValue).toBe(
      '80.000',
    );
  });

  it("reads the board's $10 as grblHAL's, naming the $10 that sends the work offset", async () => {
    const dump = GRBLHAL_LEVEL_1_GRBL_BANNER_DUMP.map((line) =>
      line.startsWith('$10=') ? '$10=0' : line,
    );
    await connectedBehindGrblProfile(grblHalLevel1(dump));

    expect(laserStatusReportFieldsOff(useLaserStore.getState())).toMatchObject({
      mask: 0,
      workOffsetOff: true,
      machinePositionUnknown: true,
      suggestedMask: 96,
    });
  });

  it('says so after the re-read when a board that shows no grblHAL stored part of a value', async () => {
    // A level 2 build lists only legacy settings, so nothing before the write
    // shows grblHAL; the `$$` re-read still does.
    const legacyOnly = GRBLHAL_LEVEL_1_GRBL_BANNER_DUMP.filter((line) =>
      /^\$(?:[0-7]|1[0-3]|2[0-7]|3[0-2]|1[0-3]\d)=/.test(line),
    );
    const wire = await connectedBehindGrblProfile(grblHalLevel1(legacyOnly));

    await useLaserStore.getState().sendConsoleCommand('$100=26,67', { confirmed: true });

    expect(wire).toContain('$100=26,67\n');
    const state = useLaserStore.getState();
    expect(state.lastWriteError).toContain(
      'The controller reports $100=26.000 after the re-read, not 26,67: it stored a different value.',
    );
    expect(state.grblSettingsRows.find((row) => row.id === 100)?.rawValue).toBe('26.000');
  });

  it('leaves stock GRBL to refuse a malformed value itself, and still refuses $22=0.5', async () => {
    const wire = await connectedBehindGrblProfile(stockGrbl());
    expect(useLaserStore.getState().controllerSettings).not.toHaveProperty(
      'listsGrblHalSignalSettings',
    );

    await expect(
      useLaserStore.getState().sendConsoleCommand('$22=0.5', { confirmed: true }),
    ).rejects.toThrow(/0\.5 would turn it off/);
    expect(wire.filter((data) => data !== '?')).toEqual([]);

    await useLaserStore
      .getState()
      .sendConsoleCommand('$100=26,67', { confirmed: true })
      .catch(() => undefined);
    expect(wire).toContain('$100=26,67\n');
    expect(useLaserStore.getState().transcript.some((entry) => entry.raw === 'error:3')).toBe(true);
    expect(useLaserStore.getState().lastWriteError ?? '').not.toContain('after the re-read');

    // A whole-number value stock GRBL stores as typed is not refused for grblHAL.
    await useLaserStore.getState().sendConsoleCommand('$22=1.0', { confirmed: true });
    expect(wire).toContain('$22=1.0\n');
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
