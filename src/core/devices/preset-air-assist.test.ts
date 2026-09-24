import { describe, expect, it } from 'vitest';
import { SCULPFUN_S30_MANUAL_AIR_PROFILE, SCULPFUN_S30_PROFILE } from './brand-laser-profiles';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { presetAirAssistUpdate } from './preset-air-assist';

function savedWithAirDisabled(profileId?: string) {
  return profileId === undefined
    ? { airAssistCommand: 'none' as const }
    : { profileId, airAssistCommand: 'none' as const };
}

describe('preset air settings for a saved preset (ADR-366)', () => {
  it('offers M8 with Air restart to a Falcon A1 Pro profile saved with air Disabled', () => {
    expect(
      presetAirAssistUpdate(savedWithAirDisabled(FALCON_A1_PRO_GRBLHAL_PROFILE.profileId)),
    ).toEqual({
      presetName: FALCON_A1_PRO_GRBLHAL_PROFILE.name,
      patch: { airAssistCommand: 'M8', airAssistRestartUnreliable: true },
    });
  });

  it('offers only the command when the preset does not flag Air restart', () => {
    expect(presetAirAssistUpdate(savedWithAirDisabled(SCULPFUN_S30_PROFILE.profileId))).toEqual({
      presetName: SCULPFUN_S30_PROFILE.name,
      patch: { airAssistCommand: 'M8' },
    });
  });

  it('leaves any configured air output alone, including one with Air restart cleared', () => {
    expect(presetAirAssistUpdate(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBeNull();
    expect(
      presetAirAssistUpdate({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, airAssistCommand: 'M7' }),
    ).toBeNull();
  });

  it('offers nothing for a preset without air, a custom profile, or no profile id', () => {
    expect(presetAirAssistUpdate(FALCON_COMPATIBLE_PROFILE)).toBeNull();
    expect(presetAirAssistUpdate(SCULPFUN_S30_MANUAL_AIR_PROFILE)).toBeNull();
    expect(presetAirAssistUpdate(DEFAULT_DEVICE_PROFILE)).toBeNull();
    expect(presetAirAssistUpdate(savedWithAirDisabled('custom-shop-laser'))).toBeNull();
    expect(presetAirAssistUpdate(savedWithAirDisabled())).toBeNull();
  });
});
