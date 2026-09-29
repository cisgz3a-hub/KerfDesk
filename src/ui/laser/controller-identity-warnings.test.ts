import { describe, expect, it } from 'vitest';
import { detectControllerFromBanner } from '../../core/controllers';
import {
  FALCON_A1_PRO_GRBLHAL_PROFILE,
  FALCON_COMPATIBLE_PROFILE,
} from '../../core/devices/falcon-profiles';
import type { JobReviewModel } from './job-review';
import {
  CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX,
  CONTROLLER_IDENTITY_WARNING_PREFIX,
  controllerIdentityWarnings,
  liveControllerIdentityWarnings,
  refreshControllerIdentityWarnings,
} from './controller-identity-warnings';

const GRBLHAL = { controllerKind: 'grblhal' } as const;
const genericGrblHal = {
  activeControllerKind: 'grblhal',
  activeControllerCommandSet: null,
  detectedControllerKind: 'grblhal',
} as const;
const falconConnection = {
  ...genericGrblHal,
  activeControllerCommandSet: 'creality-falcon-a1-pro',
} as const;
// An A1 Pro profile saved before #796 has the preset's id but no command set.
const { controllerCommandSet: _dropped, ...LEGACY_FALCON } = FALCON_A1_PRO_GRBLHAL_PROFILE;

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

  // Audit HF-8: "Grbl 1.1f" is also grblHAL's banner at COMPATIBILITY_LEVEL >= 1
  // (grblHAL report.c:310-314), so it does not contradict a grblHAL profile;
  // "Grbl 1.1h" does, because grblHAL never prints it (grbl.h:38-43).
  it('does not claim a "Grbl 1.1f" banner identifies stock GRBL on a grblHAL profile', () => {
    const compat = detectControllerFromBanner("Grbl 1.1f ['$' for help]", 'grblhal');
    expect(controllerIdentityWarnings('grblhal', 'grblhal', compat)).toEqual([]);
    const stock = detectControllerFromBanner("Grbl 1.1h ['$' for help]", 'grblhal');
    const warnings = controllerIdentityWarnings('grblhal', 'grblhal', stock);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('firmware banner identifies GRBL');
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
      effectiveOperations: [],
    };

    const refreshed = refreshControllerIdentityWarnings(
      model,
      { controllerKind: 'grbl-v1.1' },
      {
        activeControllerKind: 'grbl-v1.1',
        activeControllerCommandSet: null,
        detectedControllerKind: 'marlin',
      },
    );

    expect(refreshed.warnings).toHaveLength(2);
    expect(refreshed.warnings[0]).toContain('firmware banner identifies Marlin');
    expect(refreshed.warnings[1]).toBe('Keep this unrelated warning.');
  });

  // Connect binds the command set from the profile (ADR-322 §4). A Falcon profile
  // on a generic connection would Frame with M5 then M9 just before Start (ADR-323).
  it('warns when the profile and the active connection use different command sets', () => {
    const [generic, ...rest] = liveControllerIdentityWarnings(
      FALCON_A1_PRO_GRBLHAL_PROFILE,
      genericGrblHal,
    );
    expect(rest).toEqual([]);
    expect(generic).toContain(CONTROLLER_IDENTITY_WARNING_PREFIX);
    expect(generic).toContain(
      'the selected profile uses the Falcon A1 Pro (GRBL-compatible commands), but the active ' +
        'connection uses the generic grblHAL commands',
    );
    expect(generic).toContain("Reconnect to use the profile's command set");

    const [vendor] = liveControllerIdentityWarnings(GRBLHAL, falconConnection);
    expect(vendor).toContain(
      'the selected profile uses the generic grblHAL commands, but the active connection uses ' +
        'the Falcon A1 Pro (GRBL-compatible commands)',
    );
  });

  it('keeps the family and banner checks when the command sets match', () => {
    expect(liveControllerIdentityWarnings(FALCON_A1_PRO_GRBLHAL_PROFILE, falconConnection)).toEqual(
      [],
    );
    const [unconfirmed] = liveControllerIdentityWarnings(FALCON_A1_PRO_GRBLHAL_PROFILE, {
      ...falconConnection,
      detectedControllerKind: null,
    });
    expect(unconfirmed).toContain(CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX);
    // A family mismatch already says reconnect; the command set adds nothing.
    const family = liveControllerIdentityWarnings(FALCON_A1_PRO_GRBLHAL_PROFILE, {
      ...genericGrblHal,
      activeControllerKind: 'grbl-v1.1',
    });
    expect(family).toHaveLength(1);
    expect(family[0]).toContain('the selected profile is grblHAL');
  });

  // Saved profiles are not migrated (docs/audits/2026-09-19-machine-compatibility-
  // fixes/README.md), so Job Review names the deliberate reapplication instead.
  it('advises re-applying the Falcon preset to a saved copy that lacks its command set', () => {
    const warnings = liveControllerIdentityWarnings(LEGACY_FALCON, genericGrblHal);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CONTROLLER_IDENTITY_WARNING_PREFIX);
    expect(warnings[0]).toContain(
      `a copy of the ${FALCON_A1_PRO_GRBLHAL_PROFILE.name} preset saved before the preset had ` +
        'its own command set, so KerfDesk connects with the generic grblHAL commands instead of ' +
        'the Falcon A1 Pro (GRBL-compatible commands).',
    );
    expect(warnings[0]).toContain('Frame sends M9 just before Start');
    expect(warnings[0]).toContain(
      `Re-apply the ${FALCON_A1_PRO_GRBLHAL_PROFILE.name} preset in Machine Setup, then reconnect.`,
    );
  });

  it('does not name the current Falcon preset, the Falcon-compatible preset, or a moved copy', () => {
    expect(liveControllerIdentityWarnings(FALCON_A1_PRO_GRBLHAL_PROFILE, falconConnection)).toEqual(
      [],
    );
    expect(
      liveControllerIdentityWarnings(FALCON_COMPATIBLE_PROFILE, {
        ...genericGrblHal,
        activeControllerKind: 'grbl-v1.1',
        detectedControllerKind: 'grbl-v1.1',
      }),
    ).toEqual([]);
    expect(
      liveControllerIdentityWarnings(
        { ...LEGACY_FALCON, controllerKind: 'fluidnc' },
        {
          activeControllerKind: 'fluidnc',
          activeControllerCommandSet: null,
          detectedControllerKind: 'fluidnc',
        },
      ),
    ).toEqual([]);
  });
});
