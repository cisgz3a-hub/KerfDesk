import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import type { Job } from '../../../core/job';
import { AIR_STANDBY_WARNING, detectAirAssistStandbyWarnings } from './air-assist-standby-warnings';

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
  it('names the standby timer and its remedy for an air-on job on the Falcon A1 Pro profile', () => {
    const warnings = detectAirAssistStandbyWarnings(
      { groups: [fillGroup(true)] },
      FALCON_A1_PRO_GRBLHAL_PROFILE,
    );
    expect(warnings).toEqual([AIR_STANDBY_WARNING]);
    expect(warnings[0]).toContain('$152=100');
    expect(warnings[0]).toContain('does not reset the controller');
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
