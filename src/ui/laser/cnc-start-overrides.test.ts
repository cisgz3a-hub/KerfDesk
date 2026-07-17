import { describe, expect, it } from 'vitest';
import type { OverrideValues, StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  CNC_OVERRIDE_BLOCK_PREFIX,
  cncOverrideFinalStartIssue,
  cncOverrideStartIssue,
  cncOverrideStartWarning,
  reducedOverrideAcknowledgement,
} from '../state/cnc-accessory-readiness';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'override-line',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
        },
      ],
    },
  ],
};

// Frame-first (ADR-228): override state never blocks Start; the demoted
// messages land in the ok-result warnings for the Job Review. The projects
// must compile so the framed prepare reaches the warning collection.
const cncProject: Project = {
  ...createProject(),
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  scene: {
    ...EMPTY_SCENE,
    objects: [lineObject],
    layers: [createLayer({ id: 'L1', color: '#ff0000' })],
  },
};
const laserProject: Project = {
  ...createProject(),
  scene: {
    ...EMPTY_SCENE,
    objects: [lineObject],
    layers: [createLayer({ id: 'L1', color: '#ff0000' })],
  },
};

function warningsOf(project: Project, ovCache: OverrideValues | null): string {
  const result = prepareStartJob(project, null, {
    statusReport: idleStatus,
    alarmCode: null,
    hasActiveStreamer: false,
    ovCache,
    frameVerification: frameVerificationForProject(project),
  });
  expect(result.ok).toBe(true);
  return result.ok ? result.warnings.join('\n') : '';
}

describe('CNC Start live override baseline', () => {
  it.each([
    { feed: 200, rapid: 100, spindle: 100 },
    { feed: 100, rapid: 100, spindle: 110 },
    { feed: 100, rapid: 100, spindle: 0 },
  ])('warns on increased or invalid overrides: $feed/$rapid/$spindle', (overrides) => {
    const warnings = warningsOf(cncProject, overrides);
    expect(warnings).toContain(CNC_OVERRIDE_BLOCK_PREFIX);
    expect(warnings).toContain(
      `Current live values are feed ${overrides.feed}%, rapid ${overrides.rapid}%, spindle ${overrides.spindle}%.`,
    );
  });

  it.each([
    { feed: 80, rapid: 100, spindle: 100 },
    { feed: 100, rapid: 50, spindle: 100 },
    { feed: 70, rapid: 25, spindle: 100 },
    { feed: 100, rapid: 100, spindle: 60 },
    { feed: 80, rapid: 50, spindle: 60 },
  ])('permits positive reductions for explicit acknowledgement', (overrides) => {
    expect(cncOverrideStartIssue('cnc', overrides)).toBeNull();
    expect(cncOverrideStartWarning('cnc', overrides)).toContain(
      `feed ${overrides.feed}%, rapid ${overrides.rapid}%, spindle ${overrides.spindle}%`,
    );
  });

  it('requires the final fresh values to match the exact acknowledged reduction', () => {
    const overrides = { feed: 80, rapid: 50, spindle: 60 };
    const acknowledgement = reducedOverrideAcknowledgement(overrides);

    expect(cncOverrideFinalStartIssue('cnc', overrides, acknowledgement)).toBeNull();
    expect(cncOverrideFinalStartIssue('cnc', overrides, undefined)).toMatch(/acknowledgement/i);
    expect(cncOverrideFinalStartIssue('cnc', { ...overrides, feed: 70 }, acknowledgement)).toMatch(
      /changed after acknowledgement/i,
    );
  });

  it('does not warn about overrides at the exact 100/100/100 baseline', () => {
    const warnings = warningsOf(cncProject, { feed: 100, rapid: 100, spindle: 100 });
    expect(warnings).not.toContain(CNC_OVERRIDE_BLOCK_PREFIX);
    expect(warnings).not.toMatch(/reduced controller overrides/i);
  });

  it('does not add an acknowledgement warning for the exact baseline', () => {
    expect(cncOverrideStartWarning('cnc', { feed: 100, rapid: 100, spindle: 100 })).toBeNull();
  });

  it('asks for a fresh Ov observation instead of inventing baseline knowledge', () => {
    const warnings = warningsOf(cncProject, null);
    expect(warnings).toContain('CNC Start requires a fresh GRBL override observation');
    expect(warnings).not.toContain(CNC_OVERRIDE_BLOCK_PREFIX);
  });

  it('does not apply the CNC-only override warnings to laser jobs', () => {
    const warnings = warningsOf(laserProject, { feed: 200, rapid: 25, spindle: 10 });
    expect(warnings).not.toContain(CNC_OVERRIDE_BLOCK_PREFIX);
    expect(warnings).not.toContain('fresh GRBL override observation');
  });
});
