import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, profileCatalogEntryById } from '../../../core/devices';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import { initDeviceSetup } from './device-setup-flow';
import { starterGuessText } from './device-setup-starter-guesses';

// UX audit U2-P3-2: Next, Next on the untouched starter read "Ready to save …
// internally consistent", and the card that called these values guesses is
// gone after Save.
describe('starterGuessText', () => {
  it('names the untouched starter work area and power scale as guesses', () => {
    const state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, { machine: LASER_MACHINE_CONFIG });
    expect(starterGuessText(state)).toBe(
      "Work area 400 × 400 mm and power scale S 1000 are starter guesses from KerfDesk, not read from your machine. Check against the machine's manual before the first job.",
    );
  });

  it("names a firmware starter's bed, which Marlin cannot report", () => {
    const marlin = profileCatalogEntryById('generic-marlin-laser')!.profile;
    const state = initDeviceSetup(marlin, null, { machine: LASER_MACHINE_CONFIG });
    expect(starterGuessText(state)).toMatch(/^Work area 300 × 200 mm and power scale S 255 are/);
  });

  it('drops a value the controller reported', () => {
    const state = initDeviceSetup(
      DEFAULT_DEVICE_PROFILE,
      { bedWidth: 400, bedHeight: 400, maxPowerS: 1000 },
      { machine: LASER_MACHINE_CONFIG, controllerRead: true },
    );
    expect(starterGuessText(state)).toBeNull();
  });

  it('drops a work area the operator changed', () => {
    const state = initDeviceSetup(
      { ...DEFAULT_DEVICE_PROFILE, bedWidth: 410, maxPowerS: 255 },
      null,
      { machine: LASER_MACHINE_CONFIG },
    );
    expect(starterGuessText(state)).toBeNull();
  });

  it('says nothing for a listed machine, whose values are sourced', () => {
    const xtool = profileCatalogEntryById('xtool-d1-pro')!.profile;
    const state = initDeviceSetup(xtool, null, { machine: LASER_MACHINE_CONFIG });
    expect(starterGuessText(state)).toBeNull();
  });
});
