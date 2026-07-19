import { describe, expect, it, vi } from 'vitest';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import {
  LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE,
  createLaserModeStartEvidence,
  laserModeStartEvidenceIssue,
  m7StartEvidenceIssue,
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
  controllerBuildInfo: null,
  buildInfoObservation: null,
};

const m7Build: GrblBuildInfo = {
  protocolVersion: '1.1h',
  buildRevision: '20190830',
  userInfo: '',
  optionCodes: ['V', 'M'],
  plannerBufferBlocks: 15,
  rxBufferBytes: 128,
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
    controllerBuildInfo: null,
    controllerBuildInfoObservation: null,
    ...overrides,
  };
}

function evidence(
  snapshot: LaserModeStartSnapshot,
  unverifiedAcknowledged: boolean,
  m7Required = false,
) {
  return createLaserModeStartEvidence(snapshot, 1000, m7Required, unverifiedAcknowledged);
}

describe('laser Start acknowledgement', () => {
  it('requires informed acknowledgement when $30 or $32 is unknown', () => {
    const project = createProject();
    expect(
      laserModeStartAcknowledgementRequired(project, {
        ...knownSnapshot,
        laserModeEnabled: undefined,
      }),
    ).toBe(true);
    expect(
      laserModeStartAcknowledgementRequired(project, { ...knownSnapshot, maxPowerS: undefined }),
    ).toBe(true);
    expect(
      laserModeStartAcknowledgementRequired(project, {
        ...knownSnapshot,
        settingsCapability: 'none',
      }),
    ).toBe(true);
    expect(laserModeStartAcknowledgementRequired(project, knownSnapshot)).toBe(false);
  });

  it('keeps known $32 and $30 mismatches acknowledgeable under Frame-first policy', () => {
    const project = createProject();
    const disabled = { ...knownSnapshot, laserModeEnabled: false };
    const mismatched = { ...knownSnapshot, maxPowerS: 255 };
    expect(laserModeStartAcknowledgementRequired(project, disabled)).toBe(true);
    expect(laserModeStartAcknowledgementRequired(project, mismatched)).toBe(true);
    expect(confirmLaserModeStartEvidence(project, disabled, () => true)).toMatchObject({
      laserModeEnabled: false,
      unverifiedAcknowledged: true,
    });
    expect(confirmLaserModeStartEvidence(project, mismatched, () => true)).toMatchObject({
      maxPowerS: 255,
      unverifiedAcknowledged: true,
    });
  });

  it('requires confirmation for unknown M7 support and not for current option M proof', () => {
    const project = createProject();
    const gcode = 'M7\nG1 X1 S100\n';
    expect(laserModeStartAcknowledgementRequired(project, knownSnapshot, gcode)).toBe(true);
    const supported = {
      ...knownSnapshot,
      controllerBuildInfo: m7Build,
      buildInfoObservation: observation,
    };
    expect(laserModeStartAcknowledgementRequired(project, supported, gcode)).toBe(false);
  });

  it('never adds the laser acknowledgement to a CNC/router Start', () => {
    const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(laserModeStartAcknowledgementRequired(project, knownSnapshot)).toBe(false);
    expect(confirmLaserModeStartEvidence(project, knownSnapshot, vi.fn())).toBeUndefined();
  });

  it('records accepted unknown evidence and preserves cancellation', () => {
    const project = createProject();
    const snapshot = { ...knownSnapshot, settingsObservation: null, maxPowerS: undefined };
    const accept = vi.fn(() => true);
    const decline = vi.fn(() => false);
    expect(confirmLaserModeStartEvidence(project, snapshot, accept)).toEqual({
      ...snapshot,
      expectedMaxPowerS: 1000,
      m7Required: false,
      unverifiedAcknowledged: true,
    });
    expect(accept).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(confirmLaserModeStartEvidence(project, snapshot, decline)).toBeNull();
  });

  it('does not prompt when current settings prove $30 and $32', () => {
    const confirm = vi.fn(() => true);
    expect(confirmLaserModeStartEvidence(createProject(), knownSnapshot, confirm)).toEqual({
      ...knownSnapshot,
      expectedMaxPowerS: 1000,
      m7Required: false,
      unverifiedAcknowledged: false,
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('laser evidence at the first job-write boundary', () => {
  it('does not turn a reviewed $32=0 advisory into a wire incompatibility', () => {
    const disabled = { ...knownSnapshot, laserModeEnabled: false };
    expect(laserModeStartEvidenceIssue(source(false), evidence(disabled, true), '')).toBeNull();
  });

  it('hard-refuses proven unsupported M7 even without operator review evidence', () => {
    expect(
      laserModeStartEvidenceIssue(
        source(true, {
          controllerBuildInfo: { ...m7Build, optionCodes: ['V'] },
          controllerBuildInfoObservation: observation,
        }),
        undefined,
        'M7\n',
      ),
    ).toMatch(/does not include M/);
  });

  it('applies the exact M7 incompatibility check independently of laser evidence', () => {
    expect(
      m7StartEvidenceIssue(
        source(true, {
          controllerBuildInfo: { ...m7Build, optionCodes: ['V'] },
          controllerBuildInfoObservation: observation,
        }),
        'M7\n',
      ),
    ).toMatch(/does not include M/);
  });

  it('refuses a laser Start without operator review evidence', () => {
    expect(laserModeStartEvidenceIssue(source(true), undefined, '')).toMatch(
      /requires reviewed controller evidence/i,
    );
  });

  it('accepts unchanged verified evidence', () => {
    expect(
      laserModeStartEvidenceIssue(source(true), evidence(knownSnapshot, false), ''),
    ).toBeNull();
  });

  it('accepts unchanged unknown evidence only after informed acknowledgement', () => {
    const unknownSnapshot = { ...knownSnapshot, settingsObservation: null, maxPowerS: undefined };
    const current = source(true, {
      controllerSettings: { laserModeEnabled: true },
      controllerSettingsObservation: null,
    });
    expect(laserModeStartEvidenceIssue(current, evidence(unknownSnapshot, true), '')).toBeNull();
    expect(laserModeStartEvidenceIssue(current, evidence(unknownSnapshot, false), '')).toMatch(
      /not verified/i,
    );
  });

  it('allows fresh $32 drift after review because it remains advisory', () => {
    expect(
      laserModeStartEvidenceIssue(
        source(false, {
          controllerSettingsObservation: { sessionEpoch: 7, observedAt: 101 },
        }),
        evidence(knownSnapshot, false),
        '',
      ),
    ).toBeNull();
  });

  it('allows fresh $30 drift after review because it remains advisory', () => {
    expect(
      laserModeStartEvidenceIssue(
        source(true, { controllerSettings: { maxPowerS: 255, laserModeEnabled: true } }),
        evidence(knownSnapshot, false),
        '',
      ),
    ).toBeNull();
  });

  it('hard-refuses current build information proving M7 unsupported', () => {
    const unsupported = { ...m7Build, optionCodes: ['V'] as const };
    expect(
      laserModeStartEvidenceIssue(
        source(true, {
          controllerBuildInfo: unsupported,
          controllerBuildInfoObservation: observation,
        }),
        evidence(knownSnapshot, true, true),
        'M7\n',
      ),
    ).toMatch(/does not include M/);
  });

  it('allows settings observation or controller-session drift after review', () => {
    const accepted = evidence(knownSnapshot, false);
    expect(
      laserModeStartEvidenceIssue(
        source(true, { controllerSettingsObservation: { sessionEpoch: 7, observedAt: 101 } }),
        accepted,
        '',
      ),
    ).toBeNull();
    expect(
      laserModeStartEvidenceIssue(source(true, { controllerSessionEpoch: 8 }), accepted, ''),
    ).toBeNull();
  });

  it('still refuses when the exact program adds M7 after review', () => {
    expect(laserModeStartEvidenceIssue(source(true), evidence(knownSnapshot, false), 'M7\n')).toBe(
      LASER_MODE_START_EVIDENCE_CHANGED_MESSAGE,
    );
  });
});
