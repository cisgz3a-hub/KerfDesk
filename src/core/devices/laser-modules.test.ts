import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from './falcon-profiles';
import {
  FALCON_A1_PRO_BLUE_20W_MODULE,
  FALCON_A1_PRO_INFRARED_2W_MODULE,
  fittedLaserModuleIndex,
  laserModuleLabel,
  laserModulesFor,
} from './laser-modules';
import { validateMachineProfile } from './profile-catalog';

describe('laser modules that swap on one carriage (ADR-503)', () => {
  it('lists the Falcon A1 Pro blue and infrared modules, blue fitted as it ships', () => {
    expect(laserModulesFor(FALCON_A1_PRO_GRBLHAL_PROFILE)).toEqual([
      FALCON_A1_PRO_BLUE_20W_MODULE,
      FALCON_A1_PRO_INFRARED_2W_MODULE,
    ]);
    expect(FALCON_A1_PRO_GRBLHAL_PROFILE.laserSubProfile).toEqual(FALCON_A1_PRO_BLUE_20W_MODULE);
    expect(fittedLaserModuleIndex(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBe(0);
    const infrared = {
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      laserSubProfile: FALCON_A1_PRO_INFRARED_2W_MODULE,
    };
    expect(fittedLaserModuleIndex(infrared)).toBe(1);
  });

  it('carries the sourced module figures', () => {
    expect(FALCON_A1_PRO_BLUE_20W_MODULE).toMatchObject({
      opticalPowerW: 20,
      wavelengthNm: 455,
      spotSizeMm: { x: 0.08, y: 0.1 },
    });
    expect(FALCON_A1_PRO_INFRARED_2W_MODULE).toMatchObject({
      opticalPowerW: 2,
      wavelengthNm: 1064,
      spotSizeMm: { x: 0.03, y: 0.03 },
    });
  });

  it('has no modules to swap on a single-laser machine, and none fitted without a head', () => {
    expect(laserModulesFor(DEFAULT_DEVICE_PROFILE)).toEqual([]);
    expect(laserModulesFor({})).toEqual([]);
    const saved = { ...FALCON_A1_PRO_GRBLHAL_PROFILE };
    delete (saved as { laserSubProfile?: unknown }).laserSubProfile;
    expect(fittedLaserModuleIndex(saved)).toBe(-1);
    const other = {
      ...FALCON_A1_PRO_GRBLHAL_PROFILE,
      laserSubProfile: { ...FALCON_A1_PRO_BLUE_20W_MODULE, model: 'Someone else’s head' },
    };
    expect(fittedLaserModuleIndex(other)).toBe(-1);
  });

  it('names a module by its power and colour', () => {
    expect(laserModuleLabel(FALCON_A1_PRO_BLUE_20W_MODULE)).toBe('20 W blue (455 nm)');
    expect(laserModuleLabel(FALCON_A1_PRO_INFRARED_2W_MODULE)).toBe('2 W infrared (1064 nm)');
    expect(laserModuleLabel({ model: 'Bare', focusMode: 'unknown', airAssist: 'unknown' })).toBe(
      'Bare',
    );
  });

  it('keeps the Falcon A1 Pro preset valid with its fitted module', () => {
    expect(validateMachineProfile(FALCON_A1_PRO_GRBLHAL_PROFILE)).toEqual([]);
  });
});
