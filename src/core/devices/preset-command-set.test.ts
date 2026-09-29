import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { presetCommandSetUpdate } from './preset-command-set';

// An A1 Pro profile saved before #796 has the preset's id but no command set.
const { controllerCommandSet: _dropped, ...LEGACY_FALCON } = FALCON_A1_PRO_GRBLHAL_PROFILE;

describe('preset command set for a saved preset copy (ADR-375)', () => {
  it('names the Falcon A1 Pro preset for a saved copy that lacks its command set', () => {
    expect(presetCommandSetUpdate(LEGACY_FALCON)).toEqual({
      presetName: FALCON_A1_PRO_GRBLHAL_PROFILE.name,
      commandSet: 'creality-falcon-a1-pro',
    });
    // A copy relabelled to stock GRBL still connects through the generic driver.
    expect(presetCommandSetUpdate({ ...LEGACY_FALCON, controllerKind: 'grbl-v1.1' })).toEqual({
      presetName: FALCON_A1_PRO_GRBLHAL_PROFILE.name,
      commandSet: 'creality-falcon-a1-pro',
    });
  });

  it('offers nothing to the current preset, another preset, or a custom profile', () => {
    expect(presetCommandSetUpdate(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBeNull();
    expect(presetCommandSetUpdate(FALCON_COMPATIBLE_PROFILE)).toBeNull();
    expect(presetCommandSetUpdate(DEFAULT_DEVICE_PROFILE)).toBeNull();
    expect(presetCommandSetUpdate({ ...LEGACY_FALCON, profileId: 'custom-shop-laser' })).toBeNull();
  });

  // selectControllerDriver applies a vendor command set only to GRBL-family
  // labels, so a copy moved to another family dropped it deliberately.
  it('offers nothing once the saved copy moved to a non-GRBL family', () => {
    expect(presetCommandSetUpdate({ ...LEGACY_FALCON, controllerKind: 'fluidnc' })).toBeNull();
    expect(presetCommandSetUpdate({ ...LEGACY_FALCON, controllerKind: 'marlin' })).toBeNull();
  });
});
