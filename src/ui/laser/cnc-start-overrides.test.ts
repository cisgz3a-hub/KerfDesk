import { describe, expect, it } from 'vitest';
import type { OverrideValues, StatusReport } from '../../core/controllers/grbl';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import {
  cncOverrideFinalStartIssue,
  cncOverrideStartIssue,
  cncOverrideStartWarning,
  reducedOverrideAcknowledgement,
} from '../state/cnc-accessory-readiness';
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

const cncProject: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
const laserProject = createProject();

function preparation(project: Project, ovCache: OverrideValues | null) {
  return prepareStartJob(project, null, {
    statusReport: idleStatus,
    alarmCode: null,
    hasActiveStreamer: true,
    ovCache,
  });
}

function messages(project: Project, ovCache: OverrideValues | null): string {
  const result = preparation(project, ovCache);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.messages.join('\n');
}

describe('CNC Start live override baseline', () => {
  it.each([
    { feed: 200, rapid: 100, spindle: 100 },
    { feed: 100, rapid: 100, spindle: 10 },
  ])('blocks increased feed or changed spindle overrides: $feed/$rapid/$spindle', (overrides) => {
    expect(messages(cncProject, overrides)).toContain(
      `Current live values are feed ${overrides.feed}%, rapid ${overrides.rapid}%, spindle ${overrides.spindle}%.`,
    );
  });

  it.each([
    { feed: 80, rapid: 100, spindle: 100 },
    { feed: 100, rapid: 50, spindle: 100 },
    { feed: 70, rapid: 25, spindle: 100 },
  ])('permits a positive feed/rapid reduction for explicit acknowledgement', (overrides) => {
    expect(cncOverrideStartIssue('cnc', overrides)).toBeNull();
    expect(cncOverrideStartWarning('cnc', overrides)).toContain(
      `feed ${overrides.feed}%, rapid ${overrides.rapid}%`,
    );
  });

  it('requires the final fresh values to match the exact acknowledged reduction', () => {
    const overrides = { feed: 80, rapid: 50, spindle: 100 };
    const acknowledgement = reducedOverrideAcknowledgement(overrides);

    expect(cncOverrideFinalStartIssue('cnc', overrides, acknowledgement)).toBeNull();
    expect(cncOverrideFinalStartIssue('cnc', overrides, undefined)).toMatch(/acknowledgement/i);
    expect(cncOverrideFinalStartIssue('cnc', { ...overrides, feed: 70 }, acknowledgement)).toMatch(
      /changed after acknowledgement/i,
    );
  });

  it('does not add an override blocker for the exact 100/100/100 baseline', () => {
    expect(messages(cncProject, { feed: 100, rapid: 100, spindle: 100 })).not.toMatch(
      /controller overrides at the compiled baseline/i,
    );
  });

  it('does not add an acknowledgement warning for the exact baseline', () => {
    expect(cncOverrideStartWarning('cnc', { feed: 100, rapid: 100, spindle: 100 })).toBeNull();
  });

  it('does not claim knowledge when Ov has not been observed', () => {
    expect(messages(cncProject, null)).not.toMatch(
      /controller overrides at the compiled baseline/i,
    );
  });

  it('does not apply the CNC-only gate to laser jobs', () => {
    expect(messages(laserProject, { feed: 200, rapid: 25, spindle: 10 })).not.toMatch(
      /controller overrides at the compiled baseline/i,
    );
  });
});
