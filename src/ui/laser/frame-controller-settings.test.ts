import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { frameControllerSettingsIssues } from './frame-controller-settings';

describe('Frame controller-output contract', () => {
  it.each([
    [{ maxPowerS: 255, laserModeEnabled: true }, '$30'],
    [{ maxPowerS: 1000, laserModeEnabled: false }, '$32=0'],
  ] as const)('refuses a known-wrong laser controller setting %o', (settings, expected) => {
    const issues = frameControllerSettingsIssues(
      createProject(DEFAULT_DEVICE_PROFILE),
      settings,
      'grbl-dollar',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(expected);
  });

  it('keeps unknown laser settings as review-visible uncertainty, not invented proof', () => {
    expect(
      frameControllerSettingsIssues(createProject(DEFAULT_DEVICE_PROFILE), null, 'grbl-dollar'),
    ).toEqual([]);
  });

  it('refuses CNC Frame when $30/$32 cannot be proved by a GRBL settings read', () => {
    const project = {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };

    expect(frameControllerSettingsIssues(project, null, 'grbl-dollar')[0]).toContain(
      'not confirmed',
    );
  });

  it('accepts the explicit 12,000 RPM router-mode contract', () => {
    const project = {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };

    expect(
      frameControllerSettingsIssues(
        project,
        { maxPowerS: 12000, laserModeEnabled: false },
        'grbl-dollar',
      ),
    ).toEqual([]);
  });
});
