import { describe, expect, it } from 'vitest';
import { suggestMachineProfiles } from './profile-suggestions';

describe('suggestMachineProfiles', () => {
  it('suggests the Falcon A1 Pro grblHAL profile from a matching controller read', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'grblhal',
      detectedSettings: {
        bedWidth: 400,
        bedHeight: 400,
        maxPowerS: 1000,
      },
      controllerSettings: {
        bedWidth: 400,
        bedHeight: 400,
        maxPowerS: 1000,
        maxFeed: 10000,
      },
    });

    expect(suggestions[0]).toMatchObject({
      profileId: 'creality-falcon-a1-pro-grblhal',
      rank: 'suggested',
    });
    expect(suggestions[0]?.reasons.join(' ')).toMatch(/grblHAL/i);
    expect(suggestions[0]?.reasons.join(' ')).toMatch(/400 x 400/i);
  });

  it('keeps generic grblHAL as possible instead of silently replacing Falcon', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'grblhal',
      detectedSettings: { bedWidth: 400, bedHeight: 400, maxPowerS: 1000 },
      controllerSettings: null,
    });

    const generic = suggestions.find((item) => item.profileId === 'generic-grblhal');

    expect(generic).toMatchObject({ rank: 'possible' });
    expect(generic?.warnings.join(' ')).toMatch(/generic/i);
  });

  it('leaves unmatched profiles manual-only with a reason', () => {
    const suggestions = suggestMachineProfiles({
      detectedControllerKind: 'marlin',
      detectedSettings: { bedWidth: 300, bedHeight: 200, maxPowerS: 255 },
      controllerSettings: null,
    });

    const ruida = suggestions.find((item) => item.profileId === 'generic-ruida-rd-export');

    expect(ruida).toMatchObject({ rank: 'manual-only' });
    expect(ruida?.warnings.join(' ')).toMatch(/does not match/i);
  });
});
