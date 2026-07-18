import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
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

function controllerSource(): FramedRunControllerSource {
  return {
    controllerSessionEpoch: 7,
    controllerSettings: null,
    controllerSettingsObservation: null,
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
      controllerSettings: null,
      controllerSettingsObservation: null,
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

  it('uses stable cached WCO instead of an intermittent report WCO', () => {
    const source = controllerSource();
    const changedReportWco = {
      ...source,
      statusReport: { ...statusReport, wco: { x: 99, y: 99, z: 99 } },
    };
    expect(framedRunCompletionIssue(candidateFor(source), changedReportWco)).toBeNull();
  });

  it('refuses controller, origin, or work-Z evidence drift during Frame', () => {
    const source = controllerSource();
    expect(
      framedRunCompletionIssue(candidateFor(source), {
        ...source,
        wcoCache: { x: 3, y: 4, z: 0 },
      }),
    ).toBe(FRAME_CONTROLLER_CHANGED_MESSAGE);
  });

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
