import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, grblHalDriver, type ControllerDriver } from '../../core/controllers';
import { idleCollector, settingsMapToRows } from '../../core/controllers/grbl';
import { controllerStartPreparationStillCurrent } from '../laser/start-job-authorization';
import { consumeSettingsResponse } from './detected-settings-action';
import { framedRunControllerSnapshot } from './framed-run';
import { grblSettingsActions } from './grbl-settings-actions';
import { consumeControllerCommandResponse } from './laser-interactive-command';
import { initialLaserState } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
afterEach(resetStore);

function settingsHarness(driver: ControllerDriver = grblDriver, rejectWrite = false) {
  const stored = new Map([
    [3, '0'],
    [13, '0'],
    [30, '1000'],
    [32, '1'],
    [100, '80.000'],
    [102, '400.000'],
    [130, '300.000'],
  ]);
  let state = {
    ...initialLaserState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: 7,
    trustedPositionEpoch: 2,
    workZReferenceEpoch: 4,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    statusObservation: { sessionEpoch: 7, positionEpoch: 2, sequence: 10, observedAt: 1 },
    controllerSettings: { reportInches: false, maxPowerS: 1000, stepsPerMmX: 80 },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    detectedSettings: { maxPowerS: 1000 },
    grblSettingsRows: settingsMapToRows(stored),
    lastSettingsReadAt: 1,
    homingState: 'confirmed',
    homingProof: { sessionEpoch: 7, positionEpoch: 2, confirmedStatusSequence: 10 },
    wcoCache: { x: 0, y: 0, z: 0 },
    workOriginActive: true,
    workOriginSource: 'g54-persistent',
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 4 },
    frameVerification: {
      boundsSignature: 'completed-machine-footprint',
      wco: { x: 0, y: 0, z: 0 },
      workOriginActive: true,
    },
  } as LaserState;
  const before = state;
  const refs = {
    driver,
    settingsCollector: idleCollector(),
    settingsCollectorSessionEpoch: null,
    controllerCommand: null,
    controllerIdleWait: null,
  } as Parameters<typeof grblSettingsActions>[2];
  let atDispatch = state;
  const write = vi.fn(async (line: string) => {
    if (line === '$$\n') {
      for (const [id, value] of stored) {
        consumeSettingsResponse(refs, driver.classifyLine(`$${id}=${value}`), 7);
      }
      const result = consumeSettingsResponse(refs, { kind: 'ok' }, 7);
      if (result === null) throw new Error('Fixture settings dump did not complete');
      state = {
        ...state,
        controllerSettings: result.controllerSettings,
        controllerSettingsObservation: { sessionEpoch: 7, observedAt: 2 },
        grblSettingsRows: result.settingsRows,
        lastSettingsReadAt: 2,
        controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
      };
    } else {
      atDispatch = state;
      if (rejectWrite) throw new Error('The transport result is unknown.');
      const setting = /^\$(\d+)=(.+)\n$/.exec(line);
      if (setting === null) throw new Error(`Unexpected test write ${line}`);
      stored.set(Number(setting[1]), setting[2]!);
    }
    consumeControllerCommandResponse(refs, { kind: 'ok' }, 'ok');
  });
  const actions = grblSettingsActions(
    (partial) => {
      state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
    },
    () => state,
    refs,
    write,
  );
  return { actions, before, getState: () => state, atDispatch: () => atDispatch, write };
}

describe('firmware settings mutations preserve only current machine evidence', () => {
  it.each([
    [grblDriver, 3, '1'],
    [grblDriver, 100, '160'],
    [grblDriver, 102, '800'],
    [grblHalDriver, 130, '500'],
  ])(
    'invalidates physical evidence before %s setting $%i=%s is dispatched',
    async (driver, id, value) => {
      const harness = settingsHarness(driver);
      await harness.actions.writeGrblSetting(id, value);

      expect(harness.atDispatch()).toMatchObject({
        frameVerification: null,
        homingProof: null,
        homingState: 'unknown',
        statusReport: null,
        statusObservation: null,
        wcoCache: null,
        workZZeroEvidence: null,
        trustedPositionEpoch: 3,
        workZReferenceEpoch: 5,
      });
      expect(
        controllerStartPreparationStillCurrent(
          framedRunControllerSnapshot(harness.before),
          { ...harness.getState(), statusReport: harness.before.statusReport },
          { ignoreAdvisoryControllerEvidence: true },
        ),
      ).toBe(false);
    },
  );

  it('keeps process-only S-range writes from expiring the unchanged spatial Frame', async () => {
    const harness = settingsHarness();
    await harness.actions.writeGrblSetting(30, '2000');

    expect(harness.getState().controllerSettings?.maxPowerS).toBe(2000);
    expect(harness.getState().frameVerification).toBe(harness.before.frameVerification);
    expect(harness.getState().homingProof).toBe(harness.before.homingProof);
    expect(harness.getState().workZZeroEvidence).toBe(harness.before.workZZeroEvidence);
    expect(
      controllerStartPreparationStillCurrent(
        framedRunControllerSnapshot(harness.before),
        harness.getState(),
        { ignoreAdvisoryControllerEvidence: true },
      ),
    ).toBe(true);
  });

  it('drops the old settings observation before an uncertain firmware write can reach the board', async () => {
    const harness = settingsHarness(grblDriver, true);
    await expect(harness.actions.writeGrblSetting(30, '2000')).rejects.toThrow(/unknown/);

    expect(harness.atDispatch()).toMatchObject({
      controllerSettings: { reportInches: false },
      controllerSettingsObservation: null,
      detectedSettings: null,
      lastSettingsReadAt: null,
      grblSettingsRows: [],
    });
    expect(harness.getState().controllerSettings).toEqual({ reportInches: false });
    expect(harness.getState().controllerQualification.kind).toBe('failed');
  });
});
