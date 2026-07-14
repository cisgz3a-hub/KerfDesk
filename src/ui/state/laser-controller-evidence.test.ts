import { describe, expect, it } from 'vitest';
import { idleCollector, startCollecting } from '../../core/controllers/grbl';
import { grblDriver } from '../../core/controllers';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { handleLine, type HandlerRefs, type SetFn } from './laser-line-handler';
import { useLaserStore } from './laser-store';

function makeHarness() {
  let state = { ...useLaserStore.getState(), controllerSessionEpoch: 0, trustedPositionEpoch: 0 };
  const set: SetFn = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const refs: HandlerRefs = {
    driver: grblDriver,
    settingsCollector: startCollecting(),
    settingsCollectorSessionEpoch: 0,
    onLineArrived: null,
    controllerCommand: null,
    controllerIdleWait: null,
    pendingResetCleanup: null,
  };
  return { refs, set, get: () => state };
}

describe('invalidateControllerSessionEvidence', () => {
  it('advances the session and clears status, settings, and Home proof together', () => {
    const state = {
      ...useLaserStore.getState(),
      controllerSessionEpoch: 5,
      statusObservation: { sessionEpoch: 5, positionEpoch: 2, sequence: 9, observedAt: 1 },
      controllerSettings: { homingEnabled: true },
      controllerSettingsObservation: { sessionEpoch: 5, observedAt: 1 },
      homingState: 'confirmed' as const,
      homingProof: { sessionEpoch: 5, positionEpoch: 2, confirmedStatusSequence: 9 },
    };

    expect(invalidateControllerSessionEvidence(state)).toMatchObject({
      controllerSessionEpoch: 6,
      statusReport: null,
      statusObservation: null,
      controllerSettings: null,
      controllerSettingsObservation: null,
      homingState: 'unknown',
      homingProof: null,
    });
  });
});

describe('controller evidence lifecycle', () => {
  it('stamps status and clears all session evidence on a reboot banner', () => {
    const { refs, set, get } = makeHarness();
    set({
      controllerSessionEpoch: 4,
      homingState: 'confirmed',
      homingProof: { sessionEpoch: 4, positionEpoch: 0, confirmedStatusSequence: 1 },
      controllerSettings: { homingEnabled: true },
      controllerSettingsObservation: { sessionEpoch: 4, observedAt: 1 },
    });
    refs.settingsCollectorSessionEpoch = 4;

    handleLine(set, get, refs, async () => undefined, '<Idle|MPos:-1.000,-2.000,-3.000|FS:0,0>');
    expect(get().statusObservation).toMatchObject({
      sessionEpoch: 4,
      positionEpoch: 0,
      sequence: 1,
    });

    refs.settingsCollector = startCollecting();
    handleLine(set, get, refs, async () => undefined, 'Grbl 1.1h');
    expect(get()).toMatchObject({
      controllerSessionEpoch: 5,
      statusObservation: null,
      controllerSettings: null,
      controllerSettingsObservation: null,
      homingState: 'unknown',
      homingProof: null,
    });
    expect(refs.settingsCollector).toEqual(idleCollector());
  });

  it('invalidates position and Home proof on a direct ALARM line', () => {
    const { refs, set, get } = makeHarness();
    set({
      homingState: 'confirmed',
      homingProof: { sessionEpoch: 0, positionEpoch: 0, confirmedStatusSequence: 1 },
      statusObservation: { sessionEpoch: 0, positionEpoch: 0, sequence: 1, observedAt: 1 },
    });

    handleLine(set, get, refs, async () => undefined, 'ALARM:1');
    expect(get()).toMatchObject({
      trustedPositionEpoch: 1,
      statusObservation: null,
      homingState: 'unknown',
      homingProof: null,
    });
  });
});
