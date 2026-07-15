import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import {
  LASER_MODE_DISABLED_AT_START_MESSAGE,
  LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE,
  createLaserModeStartEvidence,
  laserModeStartEvidenceIssue,
  type LaserModeStartSnapshot,
  type LaserModeStartSnapshotSource,
} from '../state/laser-mode-start-evidence';
import {
  LASER_MODE_UNVERIFIED_START_PROMPT,
  confirmLaserModeStartEvidence,
  laserModeStartAcknowledgementRequired,
} from './laser-mode-start-acknowledgement';

const observation = { sessionEpoch: 7, observedAt: 100 } as const;
const knownSnapshot: LaserModeStartSnapshot = {
  controllerSessionEpoch: 7,
  settingsCapability: 'grbl-dollar',
  settingsObservation: observation,
  laserModeEnabled: true,
  maxPowerS: 1000,
};

function source(
  laserModeEnabled: boolean | undefined,
  overrides: Partial<LaserModeStartSnapshotSource> = {},
): LaserModeStartSnapshotSource {
  return {
    controllerSessionEpoch: 7,
    capabilities: { settings: 'grbl-dollar' },
    controllerSettings: {
      maxPowerS: 1000,
      ...(laserModeEnabled === undefined ? {} : { laserModeEnabled }),
    },
    controllerSettingsObservation: observation,
    ...overrides,
  };
}

describe('laser-mode Start acknowledgement', () => {
  it('requires informed acknowledgement for every laser Start with unknown $32', () => {
    const project = createProject();

    expect(
      laserModeStartAcknowledgementRequired(project, {
        ...knownSnapshot,
        laserModeEnabled: undefined,
      }),
    ).toBe(true);
    expect(
      laserModeStartAcknowledgementRequired(project, {
        ...knownSnapshot,
        settingsCapability: 'readonly-dump',
        laserModeEnabled: undefined,
      }),
    ).toBe(true);
    expect(
      laserModeStartAcknowledgementRequired(project, {
        ...knownSnapshot,
        settingsCapability: 'none',
      }),
    ).toBe(true);
    expect(laserModeStartAcknowledgementRequired(project, knownSnapshot)).toBe(false);
  });

  it('never adds the laser acknowledgement to a CNC/router Start', () => {
    const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };

    expect(laserModeStartAcknowledgementRequired(project, knownSnapshot)).toBe(false);
    expect(confirmLaserModeStartEvidence(project, knownSnapshot, vi.fn())).toBeUndefined();
  });

  it('treats $32=1 without a current same-session observation as unverified', () => {
    const snapshot = { ...knownSnapshot, settingsObservation: null };
    const confirm = vi.fn(() => true);

    expect(confirmLaserModeStartEvidence(createProject(), snapshot, confirm)).toEqual({
      ...snapshot,
      unverifiedAcknowledged: true,
    });
    expect(confirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
  });

  it('records an accepted unknown-$32 acknowledgement and preserves cancellation', () => {
    const project = createProject();
    const snapshot: LaserModeStartSnapshot = {
      ...knownSnapshot,
      settingsObservation: null,
      laserModeEnabled: undefined,
    };
    const accept = vi.fn(() => true);
    const decline = vi.fn(() => false);

    expect(confirmLaserModeStartEvidence(project, snapshot, accept)).toEqual({
      ...snapshot,
      unverifiedAcknowledged: true,
    });
    expect(accept).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(confirmLaserModeStartEvidence(project, snapshot, decline)).toBeNull();
  });

  it('does not prompt when the current snapshot already proves $32=1', () => {
    const confirm = vi.fn(() => true);

    expect(confirmLaserModeStartEvidence(createProject(), knownSnapshot, confirm)).toEqual({
      ...knownSnapshot,
      unverifiedAcknowledged: false,
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('laser-mode evidence at the first job-write boundary', () => {
  it('accepts unchanged $32=1 evidence', () => {
    expect(
      laserModeStartEvidenceIssue(source(true), createLaserModeStartEvidence(knownSnapshot, false)),
    ).toBeNull();
  });

  it('accepts unchanged unknown evidence only after the informed acknowledgement', () => {
    const unknownSnapshot: LaserModeStartSnapshot = {
      ...knownSnapshot,
      settingsObservation: null,
      laserModeEnabled: undefined,
    };
    const current = source(undefined, { controllerSettingsObservation: null });

    expect(
      laserModeStartEvidenceIssue(current, createLaserModeStartEvidence(unknownSnapshot, true)),
    ).toBeNull();
    expect(
      laserModeStartEvidenceIssue(current, createLaserModeStartEvidence(unknownSnapshot, false)),
    ).toMatch(/not verified/i);
  });

  it('refuses a fresh $32=0 report even when earlier evidence proved $32=1', () => {
    expect(
      laserModeStartEvidenceIssue(
        source(false, {
          controllerSettingsObservation: { sessionEpoch: 7, observedAt: 101 },
        }),
        createLaserModeStartEvidence(knownSnapshot, false),
      ),
    ).toBe(LASER_MODE_DISABLED_AT_START_MESSAGE);
  });

  it('refuses observation, setting, or controller-session drift before job bytes', () => {
    const evidence = createLaserModeStartEvidence(knownSnapshot, false);

    expect(
      laserModeStartEvidenceIssue(
        source(true, { controllerSettingsObservation: { sessionEpoch: 7, observedAt: 101 } }),
        evidence,
      ),
    ).toBe(LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE);
    expect(laserModeStartEvidenceIssue(source(true, { controllerSessionEpoch: 8 }), evidence)).toBe(
      LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE,
    );
    expect(
      laserModeStartEvidenceIssue(
        source(true, { controllerSettings: { maxPowerS: 255 } }),
        evidence,
      ),
    ).toBe(LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE);
  });
});
