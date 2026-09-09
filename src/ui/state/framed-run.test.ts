import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import {
  createFramedRunPermit,
  FRAME_CONTROLLER_CHANGED_MESSAGE,
  FRAME_RETURN_POSITION_CHANGED_MESSAGE,
  framedRunControllerSnapshot,
  framedRunCompletionIssue,
  type FramedRunCandidate,
  type FramedRunControllerSource,
} from './framed-run';

const statusReport: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 12, y: 34, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: { x: 2, y: 4, z: 0 },
};
const controllerBuildInfo: GrblBuildInfo = {
  protocolVersion: '1.1h',
  buildRevision: '20190830',
  userInfo: '',
  optionCodes: ['V', 'N', 'M'],
  plannerBufferBlocks: 15,
  rxBufferBytes: 128,
};
const controllerBuildInfoObservation = { sessionEpoch: 7, observedAt: 101 } as const;

function controllerSource(): FramedRunControllerSource {
  return {
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerBuildInfo,
    controllerBuildInfoObservation,
    statusReport,
    statusSequence: 19,
    wcoCache: { x: 2, y: 4, z: 0 },
    workOriginActive: true,
    workOriginSource: 'g92',
    workZReferenceEpoch: 3,
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 3 },
  };
}

function candidateFor(source: FramedRunControllerSource): FramedRunCandidate {
  return {
    controllerBeforeFrame: framedRunControllerSnapshot(source),
    returnToWorkPosition: { x: 10, y: 30 },
  } as FramedRunCandidate;
}

describe('FramedRun completion evidence', () => {
  it('captures the exact controller state observed at physical Frame completion', () => {
    expect(framedRunControllerSnapshot(controllerSource())).toEqual({
      controllerSessionEpoch: 7,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
      controllerSettings: null,
      controllerSettingsObservation: null,
      controllerBuildInfo,
      controllerBuildInfoObservation,
      statusReport,
      wcoCache: { x: 2, y: 4, z: 0 },
      workOriginActive: true,
      workOriginSource: 'g92',
      trustedPositionEpoch: 0,
      workZReferenceEpoch: 3,
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 3 },
    });
  });

  it('binds the permit to the candidate and final status sequence', () => {
    const candidate = { executionSignature: 'exact-run' } as FramedRunCandidate;
    const permit = createFramedRunPermit(candidate, controllerSource());

    expect(permit.kind).toBe('ready');
    expect(permit.candidate).toBe(candidate);
    expect(permit.completedStatusSequence).toBe(19);
    expect(permit.controller.statusReport).toBe(statusReport);
  });

  it('accepts unchanged setup and the reported pre-Frame work position', () => {
    const source = controllerSource();
    expect(framedRunCompletionIssue(candidateFor(source), source)).toBeNull();
  });

  it('keeps identity drift advisory instead of turning it into a new Frame refusal', () => {
    const source = controllerSource();
    expect(
      framedRunCompletionIssue(candidateFor(source), {
        ...source,
        detectedControllerKind: 'marlin',
      }),
    ).toBeNull();
  });

  it('keeps active-controller drift advisory instead of turning it into a new Frame refusal', () => {
    const source = controllerSource();
    expect(
      framedRunCompletionIssue(candidateFor(source), {
        ...source,
        activeControllerKind: 'marlin',
      }),
    ).toBeNull();
  });

  it('uses stable cached WCO instead of an intermittent report WCO', () => {
    const source = controllerSource();
    const changedReportWco = {
      ...source,
      statusReport: { ...statusReport, wco: { x: 99, y: 99, z: 99 } },
    };
    expect(framedRunCompletionIssue(candidateFor(source), changedReportWco)).toBeNull();
  });

  it.each<Partial<FramedRunControllerSource>>([
    { controllerSessionEpoch: 8 },
    { wcoCache: { x: 3, y: 4, z: 0 } },
    { workOriginActive: false },
    { workOriginSource: 'g54-persistent' },
    { trustedPositionEpoch: 1 },
    { workZReferenceEpoch: 4 },
    { workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 4 } },
  ])('refuses factual controller, origin, or work-Z drift: %j', (change) => {
    const source = controllerSource();
    expect(framedRunCompletionIssue(candidateFor(source), { ...source, ...change })).toBe(
      FRAME_CONTROLLER_CHANGED_MESSAGE,
    );
  });

  it.each(['settings', 'settings-observation', 'build-info', 'build-observation', 'all'])(
    'retains the exact candidate across an equivalent %s refresh',
    (refresh) => {
      const source = {
        ...controllerSource(),
        controllerSettings: { maxPowerS: 1000, laserModeEnabled: true, reportInches: false },
        controllerSettingsObservation: { sessionEpoch: 7, observedAt: 100 },
      };
      const refreshed = {
        ...source,
        ...((refresh === 'settings' || refresh === 'all') && {
          controllerSettings: { ...source.controllerSettings },
        }),
        ...((refresh === 'settings-observation' || refresh === 'all') && {
          controllerSettingsObservation: { sessionEpoch: 7, observedAt: 102 },
        }),
        ...((refresh === 'build-info' || refresh === 'all') && {
          controllerBuildInfo: {
            ...controllerBuildInfo,
            optionCodes: [...controllerBuildInfo.optionCodes],
          },
        }),
        ...((refresh === 'build-observation' || refresh === 'all') && {
          controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 102 },
        }),
      };
      expect(framedRunCompletionIssue(candidateFor(source), refreshed)).toBeNull();
    },
  );

  it.each([null, {}, { reportInches: false }])(
    'uses the same millimetre interpretation for equivalent report-unit evidence: %j',
    (settings) => {
      const source = controllerSource();
      expect(
        framedRunCompletionIssue(candidateFor(source), {
          ...source,
          controllerSettings: settings,
        }),
      ).toBeNull();
    },
  );

  it.each([false, true])(
    'retains equivalent fresh objects with reportInches=%s',
    (reportInches) => {
      const source = { ...controllerSource(), controllerSettings: { reportInches } };
      expect(
        framedRunCompletionIssue(candidateFor(source), {
          ...source,
          controllerSettings: { reportInches },
        }),
      ).toBeNull();
    },
  );

  it.each([0, 10])(
    'preserves a report-unit change dependency at position/WCO basis %s',
    (position) => {
      const source = {
        ...controllerSource(),
        controllerSettings: { reportInches: false },
        statusReport: {
          ...statusReport,
          mPos: { x: position, y: position, z: 0 },
          wco: { x: 0, y: 0, z: 0 },
        },
        wcoCache: { x: 0, y: 0, z: 0 },
      };
      const inches = { ...source, controllerSettings: { reportInches: true } };
      // Zero is numerically identical in both units. At nonzero positions even
      // an equivalent millimetre location does not erase this interpretation change.
      expect(framedRunCompletionIssue(candidateFor(source), inches)).toBe(
        FRAME_CONTROLLER_CHANGED_MESSAGE,
      );
      expect(
        framedRunCompletionIssue(candidateFor(source), {
          ...inches,
          statusReport: {
            ...inches.statusReport,
            mPos: { x: position / 25.4, y: position / 25.4, z: 0 },
          },
        }),
      ).toBe(FRAME_CONTROLLER_CHANGED_MESSAGE);
      expect(framedRunCompletionIssue(candidateFor(inches), source)).toBe(
        FRAME_CONTROLLER_CHANGED_MESSAGE,
      );
    },
  );

  it('refuses a final position that did not return to the pre-Frame XYZ', () => {
    const source = controllerSource();
    expect(
      framedRunCompletionIssue(candidateFor(source), {
        ...source,
        statusReport: { ...statusReport, mPos: { x: 13, y: 34, z: 0 } },
      }),
    ).toBe(FRAME_RETURN_POSITION_CHANGED_MESSAGE);
  });
});
