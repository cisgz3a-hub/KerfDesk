// A laser on a firmware that reports no power scale (annoyance audit A2
// B3-P2-1, ADR-095 Amendment 1): its own acknowledgement wording before the
// operator's statement, and no acknowledgement after it. The statement is
// carried in the Start evidence as the operator's word, never as verified.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createOperatorPowerScaleStatement,
  unreportedPowerScaleStartPrompt,
} from '../../core/devices/power-scale-statement';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import {
  laserModeStartEvidenceIssue,
  laserModeStartSnapshotIsVerified,
  operatorStatedPowerScaleCovers,
  type LaserModeStartSnapshot,
} from '../state/laser-mode-start-evidence';
import {
  LASER_MODE_UNVERIFIED_START_PROMPT,
  confirmLaserModeStartEvidence,
  laserModeStartAcknowledgementRequired,
  laserModeStartReview,
} from './laser-mode-start-acknowledgement';

const STATED_AT = '2026-11-11T10:00:00.000Z';

const MARLIN: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  gcodeDialect: { dialectId: 'marlin-inline' },
  streamingMode: 'ping-pong',
  maxPowerS: 255,
};
const SMOOTHIE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

/** What a Marlin or Smoothieware session gives Start: no settings at all. */
const noSettings: LaserModeStartSnapshot = {
  controllerSessionEpoch: 7,
  settingsCapability: 'none',
  settingsObservation: null,
  laserModeEnabled: undefined,
  maxPowerS: undefined,
  controllerBuildInfo: null,
  buildInfoObservation: null,
};

function stated(device: DeviceProfile): DeviceProfile {
  const statement = createOperatorPowerScaleStatement(device, STATED_AT);
  if (statement === null) throw new Error('fixture: this firmware takes a statement');
  return { ...device, operatorPowerScaleStatement: statement };
}

describe.each([
  ['Marlin', MARLIN],
  ['Smoothieware', SMOOTHIE],
])('a %s laser before the operator has stated the power scale', (name, device) => {
  const project = createProject(device);

  it('can never be verified, as the audit found', () => {
    expect(laserModeStartSnapshotIsVerified(noSettings, device.maxPowerS)).toBe(false);
    expect(laserModeStartAcknowledgementRequired(project, noSettings)).toBe(true);
  });

  it('is asked in its own words, with no GRBL advice it cannot follow', () => {
    const review = laserModeStartReview(project, noSettings);
    expect(review).toEqual({ kind: 'unverified', prompt: unreportedPowerScaleStartPrompt(device) });
    const confirm = vi.fn((_message: string) => true);
    const evidence = confirmLaserModeStartEvidence(project, noSettings, confirm);
    const prompt = confirm.mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain(`${name} does not report its laser power scale`);
    expect(prompt).not.toBe(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(prompt).not.toMatch(/\$3[0-2]|GRBL/);
    expect(evidence).toMatchObject({ unverifiedAcknowledged: true });
    expect(evidence).not.toHaveProperty('operatorStatedPowerScale');
  });

  it('still starts nothing when the operator declines', () => {
    expect(confirmLaserModeStartEvidence(project, noSettings, () => false)).toBeNull();
  });
});

describe.each([
  ['Marlin', MARLIN],
  ['Smoothieware', SMOOTHIE],
])('a %s laser after the operator has stated the power scale', (_name, device) => {
  const project = createProject(stated(device));
  const statement = project.device.operatorPowerScaleStatement;

  it('asks nothing, and is operator-stated, not verified', () => {
    expect(laserModeStartReview(project, noSettings)).toEqual({
      kind: 'operator-stated',
      statement,
    });
    expect(laserModeStartAcknowledgementRequired(project, noSettings)).toBe(false);
    expect(laserModeStartSnapshotIsVerified(noSettings, device.maxPowerS)).toBe(false);
  });

  it('carries the statement in the Start evidence without a click', () => {
    const confirm = vi.fn(() => true);
    const evidence = confirmLaserModeStartEvidence(project, noSettings, confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(evidence).toEqual({
      ...noSettings,
      expectedMaxPowerS: device.maxPowerS,
      m7Required: false,
      unverifiedAcknowledged: false,
      operatorStatedPowerScale: statement,
    });
    if (evidence == null) throw new Error('expected evidence');
    expect(operatorStatedPowerScaleCovers(evidence)).toBe(true);
    expect(laserModeStartEvidenceIssue(evidence, '')).toBeNull();
  });

  it('still asks for a program KerfDesk did not build', () => {
    const confirm = vi.fn(() => true);
    const evidence = confirmLaserModeStartEvidence(project, noSettings, confirm, '', {
      prompt: 'external prompt',
      operatorStatementApplies: false,
    });
    expect(confirm).toHaveBeenCalledExactlyOnceWith('external prompt');
    expect(evidence).toMatchObject({ unverifiedAcknowledged: true });
    expect(evidence).not.toHaveProperty('operatorStatedPowerScale');
  });
});

describe('what the statement does not cover', () => {
  it('is void once the profile no longer matches it', () => {
    for (const change of [
      { maxPowerS: 100 },
      { controllerKind: 'smoothieware' as const },
      { gcodeDialect: { dialectId: 'marlin-fan' as const } },
    ]) {
      const project = createProject({ ...stated(MARLIN), ...change });
      expect(laserModeStartReview(project, noSettings)?.kind).toBe('unverified');
    }
  });

  it('never stands in for a controller that reports settings', () => {
    // A mismatch, a failed read and laser mode off all keep their question.
    const project = createProject(stated(MARLIN));
    for (const snapshot of [
      { ...noSettings, settingsCapability: 'grbl-dollar' as const },
      { ...noSettings, settingsCapability: 'readonly-dump' as const, maxPowerS: 1000 },
      {
        ...noSettings,
        settingsCapability: 'grbl-dollar' as const,
        settingsObservation: { sessionEpoch: 7, observedAt: 1 },
        laserModeEnabled: false,
        maxPowerS: 255,
      },
    ]) {
      expect(laserModeStartReview(project, snapshot)).toEqual({
        kind: 'unverified',
        prompt: LASER_MODE_UNVERIFIED_START_PROMPT,
      });
    }
  });

  it('is refused at the wire when the evidence does not hold together', () => {
    const project = createProject(stated(MARLIN));
    const evidence = confirmLaserModeStartEvidence(project, noSettings, () => true);
    if (evidence == null) throw new Error('expected evidence');
    // A statement for another Full-power S, or beside a settings report.
    expect(laserModeStartEvidenceIssue({ ...evidence, expectedMaxPowerS: 100 }, '')).not.toBeNull();
    expect(
      laserModeStartEvidenceIssue({ ...evidence, settingsCapability: 'grbl-dollar' }, ''),
    ).not.toBeNull();
    const { operatorStatedPowerScale: _removed, ...unstated } = evidence;
    expect(laserModeStartEvidenceIssue(unstated, '')).not.toBeNull();
  });

  it('leaves a CNC job and other families without a settings report as they were', () => {
    const cnc = { ...createProject(stated(MARLIN)), machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(laserModeStartReview(cnc, noSettings)).toBeNull();
    const ruida = createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' });
    expect(laserModeStartReview(ruida, noSettings)).toEqual({
      kind: 'unverified',
      prompt: LASER_MODE_UNVERIFIED_START_PROMPT,
    });
  });
});
