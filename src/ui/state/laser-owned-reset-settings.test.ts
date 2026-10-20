import { afterEach, describe, expect, it } from 'vitest';
import { idleCollector, settingsMapToRows } from '../../core/controllers/grbl';
import { runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { noteControllerSettingWrite } from './laser-owned-reset-settings';
import { useStore } from './store';

const ROWS = settingsMapToRows(
  new Map([
    [30, '1000'],
    [130, '400'],
  ]),
);

afterEach(() => {
  useStore.getState().setCncLiveCaps(null);
});

// A connected session whose `$$` and `$I` were read in its current epoch.
function readSettingsHarness() {
  const harness = makeLineHandlerHarness();
  const { refs, set, get } = harness;
  refs.settingsCollector = idleCollector();
  refs.settingsCollectorSessionEpoch = null;
  const epoch = get().controllerSessionEpoch;
  set({
    controllerSettings: { maxPowerS: 1_000, bedWidth: 400 },
    controllerSettingsObservation: { sessionEpoch: epoch, observedAt: 11 },
    controllerBuildInfoRawLines: ['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]'],
    controllerBuildInfoObservation: { sessionEpoch: epoch, observedAt: 12 },
    controllerQualification: { kind: 'qualified', epoch, settings: 'verified' },
    grblSettingsRows: ROWS,
    lastSettingsReadAt: 13,
    activeWcs: 'G55',
  });
  const writes: string[] = [];
  const safeWrite = async (line: string): Promise<void> => {
    writes.push(line);
  };
  return { ...harness, epoch, writes, safeWrite };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('settings across a reset KerfDesk sent (ADR-648, audit D-5)', () => {
  it("keeps the `$$` and `$I` snapshot for the banner that closes KerfDesk's own reset", async () => {
    const { refs, set, get, epoch, writes, safeWrite } = readSettingsHarness();

    const reset = runGrblDisconnectTransaction(set, refs, safeWrite, {
      retainConnection: true,
      action: 'stop',
      cleanupLines: ['M5', 'M9'],
    });
    await flush();
    expect(writes).toContain('\x18');
    // The reset owner retires the old session's evidence until its banner.
    expect(get().grblSettingsRows).toEqual([]);

    handleLine(set, get, refs, safeWrite, "Grbl 1.1h ['$' for help]");
    await reset;

    const next = get().controllerSessionEpoch;
    expect(next).toBeGreaterThan(epoch);
    expect(get()).toMatchObject({
      controllerSettings: { maxPowerS: 1_000, bedWidth: 400 },
      controllerSettingsObservation: { sessionEpoch: next, observedAt: 11 },
      controllerBuildInfoRawLines: ['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]'],
      controllerBuildInfoObservation: { sessionEpoch: next, observedAt: 12 },
      grblSettingsRows: ROWS,
      // The original read time: nothing announces a read that did not happen.
      lastSettingsReadAt: 13,
      // The modal state and active WCS did restart, so `$G` is read again.
      activeWcs: null,
      controllerQualification: { kind: 'qualifying', epoch: next, phase: 'reset-cleanup' },
    });
    expect(useStore.getState().cncLiveCaps).not.toBeNull();
  });

  it('discards the snapshot for a banner KerfDesk did not cause', () => {
    const { refs, set, get, safeWrite } = readSettingsHarness();

    handleLine(set, get, refs, safeWrite, "Grbl 1.1h ['$' for help]");

    expect(get()).toMatchObject({
      controllerSettings: null,
      controllerSettingsObservation: null,
      controllerBuildInfoObservation: null,
      grblSettingsRows: [],
      lastSettingsReadAt: null,
    });
  });

  it('discards the snapshot when a `$` setting was written since it was read', async () => {
    const { refs, set, get, safeWrite } = readSettingsHarness();
    noteControllerSettingWrite(refs, '$RST=$\n');

    const reset = runGrblDisconnectTransaction(set, refs, safeWrite, {
      retainConnection: true,
      action: 'stop',
      cleanupLines: ['M5', 'M9'],
    });
    await flush();
    handleLine(set, get, refs, safeWrite, "Grbl 1.1h ['$' for help]");
    await reset;

    expect(get()).toMatchObject({
      controllerSettings: null,
      grblSettingsRows: [],
      lastSettingsReadAt: null,
    });
  });

  it('carries the snapshot to that one banner only', async () => {
    const { refs, set, get, safeWrite } = readSettingsHarness();
    const reset = runGrblDisconnectTransaction(set, refs, safeWrite, {
      retainConnection: true,
      action: 'stop',
      cleanupLines: ['M5', 'M9'],
    });
    await flush();
    handleLine(set, get, refs, safeWrite, "Grbl 1.1h ['$' for help]");
    await reset;
    expect(get().grblSettingsRows).toEqual(ROWS);

    handleLine(set, get, refs, safeWrite, "Grbl 1.1h ['$' for help]");

    expect(get()).toMatchObject({ grblSettingsRows: [], lastSettingsReadAt: null });
  });
});

describe('noteControllerSettingWrite', () => {
  it('counts `$` assignments, in a single write or a whole program, and nothing else', () => {
    const refs: { settingsWriteRevision?: number } = {};
    for (const line of ['$$\n', '$G\n', '$J=G91 X1 F100\n', 'G10 L20 P1 X0\n', 'G1 X1 ($30=1)\n']) {
      noteControllerSettingWrite(refs, line);
    }
    expect(refs.settingsWriteRevision).toBeUndefined();

    noteControllerSettingWrite(refs, '$30=1000\n');
    noteControllerSettingWrite(refs, 'G21\nG90\n$I=shop laser\nG1 X1\n');
    expect(refs.settingsWriteRevision).toBe(2);
  });
});
