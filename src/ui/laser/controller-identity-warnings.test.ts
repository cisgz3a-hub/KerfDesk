import { describe, expect, it } from 'vitest';
import type { JobReviewModel } from './job-review';
import {
  CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX,
  CONTROLLER_IDENTITY_WARNING_PREFIX,
  controllerIdentityWarnings,
  refreshControllerIdentityWarnings,
} from './controller-identity-warnings';

describe('controller identity warnings', () => {
  it('stays quiet when configured, active, and detected identities match', () => {
    expect(controllerIdentityWarnings('grbl-v1.1', 'grbl-v1.1', 'grbl-v1.1')).toEqual([]);
  });

  it('warns without refusing when the active connection differs from the profile', () => {
    const warnings = controllerIdentityWarnings('marlin', 'grbl-v1.1', 'grbl-v1.1');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CONTROLLER_IDENTITY_WARNING_PREFIX);
    expect(warnings[0]).toContain('Marlin');
    expect(warnings[0]).toContain('GRBL v1.1');
    expect(warnings[0]).toContain('Reconnect using the selected profile');
  });

  it('warns when the banner differs from an otherwise matching connection', () => {
    const warnings = controllerIdentityWarnings('grbl-v1.1', 'grbl-v1.1', 'marlin');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CONTROLLER_IDENTITY_WARNING_PREFIX);
    expect(warnings[0]).toContain('firmware banner identifies Marlin');
  });

  it('discloses a GRBL-family variant instead of silently treating it as identical', () => {
    const warnings = controllerIdentityWarnings('grbl-v1.1', 'grblhal', 'grblhal');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('GRBL v1.1');
    expect(warnings[0]).toContain('grblHAL');
  });

  it('treats missing detection as advisory evidence rather than a match', () => {
    const warnings = controllerIdentityWarnings('grblhal', 'grblhal', null);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX);
    expect(warnings[0]).toContain('grblHAL');
  });

  it('replaces stale identity disclosure with the live Job Review evidence', () => {
    const model: JobReviewModel = {
      machineKind: 'laser',
      stats: [],
      warnings: [
        `${CONTROLLER_IDENTITY_WARNING_PREFIX} stale`,
        `${CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX} stale`,
        'Keep this unrelated warning.',
      ],
      resolvedOriginLabel: 'Absolute',
      toolPlanLabels: [],
      acknowledgement: { kind: 'laser-verified' },
      outputQualityFacts: [],
    };

    const refreshed = refreshControllerIdentityWarnings(model, 'grbl-v1.1', 'grbl-v1.1', 'marlin');

    expect(refreshed.warnings).toHaveLength(2);
    expect(refreshed.warnings[0]).toContain('firmware banner identifies Marlin');
    expect(refreshed.warnings[1]).toBe('Keep this unrelated warning.');
  });
});
