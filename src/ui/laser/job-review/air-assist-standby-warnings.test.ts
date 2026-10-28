import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import type { Job } from '../../../core/job';
import { airStandbyWarning, detectAirAssistStandbyWarnings } from './air-assist-standby-warnings';

// A Falcon whose firmware numbers settings as stock GRBL, as the A1's does.
const FALCON_ON_GRBL = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, controllerKind: 'grbl-v1.1' } as const;

function fillGroup(airAssist: boolean): Job['groups'][number] {
  return {
    kind: 'fill',
    layerId: 'fill',
    color: '#000000',
    power: 50,
    speed: 2500,
    passes: 1,
    airAssist,
    overscanMm: 5,
    segments: [],
  };
}

describe('detectAirAssistStandbyWarnings', () => {
  it("names the A1's $152 standby timer and $152=100 for a Falcon on stock GRBL", () => {
    const warnings = detectAirAssistStandbyWarnings({ groups: [fillGroup(true)] }, FALCON_ON_GRBL);
    expect(warnings).toEqual([airStandbyWarning('standby-setting')]);
    expect(warnings[0]).toContain('$152=100');
    expect(warnings[0]).toContain('does not reset the controller');
  });

  // Rolling audit v5 J8-P3-2 (ADR-370 Amendment 1): on the A1 Pro's grblHAL,
  // $150-$152 are the motor microsteps, so the A1's remedy is not offered.
  it('gives the Falcon A1 Pro only the firmware remedy and warns off the A1 air settings', () => {
    const warnings = detectAirAssistStandbyWarnings(
      { groups: [fillGroup(true)] },
      FALCON_A1_PRO_GRBLHAL_PROFILE,
    );
    expect(warnings).toEqual([airStandbyWarning('grblhal-falcon')]);
    expect(warnings[0]).not.toContain('$152=100');
    expect(warnings[0]).not.toContain('from the Console');
    expect(warnings[0]).toContain('install the latest firmware and confirm with an air test');
    expect(warnings[0]).toContain('$150-$152 set the motor microsteps');
    expect(warnings[0]).toContain('does not reset the controller');
  });

  it('names no $152 setting for a non-Falcon machine with Air restart ticked', () => {
    const warnings = detectAirAssistStandbyWarnings(
      { groups: [fillGroup(true)] },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8', airAssistRestartUnreliable: true },
    );
    expect(warnings).toEqual([airStandbyWarning('firmware')]);
    expect(warnings[0]).not.toContain('$15');
  });

  it('stays silent when no operation uses air, when air output is disabled, or on a plain profile', () => {
    expect(
      detectAirAssistStandbyWarnings({ groups: [fillGroup(false)] }, FALCON_A1_PRO_GRBLHAL_PROFILE),
    ).toEqual([]);
    expect(
      detectAirAssistStandbyWarnings(
        { groups: [fillGroup(true)] },
        { ...FALCON_A1_PRO_GRBLHAL_PROFILE, airAssistCommand: 'none' },
      ),
    ).toEqual([]);
    expect(
      detectAirAssistStandbyWarnings(
        { groups: [fillGroup(true)] },
        { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' },
      ),
    ).toEqual([]);
  });
});
