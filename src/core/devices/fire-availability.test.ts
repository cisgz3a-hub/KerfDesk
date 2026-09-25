import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from './device-profile';
import type { DeviceProfile } from './device-profile';
import {
  enabledFireControl,
  fireButtonPercent,
  fireButtonPowerS,
  fireOfferIssue,
  firePowerIssue,
  formatFirePercent,
  type FireControllerSupport,
} from './fire-availability';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from './falcon-profiles';

const GRBL: FireControllerSupport = { label: 'GRBL v1.1', lowPowerFire: true };
const MARLIN: FireControllerSupport = { label: 'Marlin', lowPowerFire: false };
const ON = { enabled: true, maxPowerPercent: 1 } as const;

function withHead(technology: 'diode' | 'co2' | 'fiber' | 'unknown'): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    laserSubProfile: { model: 'test head', technology, focusMode: 'manual', airAssist: 'none' },
    fireControl: ON,
  };
}

describe('where the Fire button may exist', () => {
  it('offers the opt-in to a laser profile on a Fire-capable controller without the catalog capability', () => {
    expect(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.capabilities).not.toContain('low-power-fire');
    expect(fireOfferIssue(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, GRBL)).toBeNull();
    expect(fireOfferIssue(DEFAULT_DEVICE_PROFILE, GRBL)).toBeNull();
  });

  it('keeps an existing Falcon opt-in working', () => {
    const falcon = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, fireControl: ON };
    expect(enabledFireControl(falcon, GRBL)).toBe(falcon.fireControl);
  });

  it('is off until the machine opts in, like LightBurn', () => {
    expect(DEFAULT_DEVICE_PROFILE.fireControl).toBeUndefined();
    expect(enabledFireControl(DEFAULT_DEVICE_PROFILE, GRBL)).toBeNull();
    const declined = { ...DEFAULT_DEVICE_PROFILE, fireControl: { ...ON, enabled: false } };
    expect(enabledFireControl(declined, GRBL)).toBeNull();
  });

  it('refuses a controller family that cannot drive Fire, even with an opt-in', () => {
    const profile = { ...DEFAULT_DEVICE_PROFILE, fireControl: ON };
    expect(fireOfferIssue(profile, MARLIN)).toContain('Marlin controllers have no Fire button');
    expect(enabledFireControl(profile, MARLIN)).toBeNull();
  });

  it('refuses a CNC-only profile', () => {
    const cncOnly: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      capabilities: ['grbl', 'cnc-output'],
      fireControl: ON,
    };
    expect(fireOfferIssue(cncOnly, GRBL)).toContain('no laser output');
    expect(enabledFireControl(cncOnly, GRBL)).toBeNull();
  });

  it('refuses invisible-beam CO2 and fiber heads and keeps diode or unknown heads', () => {
    expect(fireOfferIssue(withHead('co2'), GRBL)).toContain('CO2 laser has an invisible beam');
    expect(fireOfferIssue(withHead('fiber'), GRBL)).toContain('fiber laser has an invisible beam');
    expect(enabledFireControl(withHead('co2'), GRBL)).toBeNull();
    expect(enabledFireControl(withHead('diode'), GRBL)).toEqual(ON);
    expect(enabledFireControl(withHead('unknown'), GRBL)).toEqual(ON);
  });
});

describe('what a press sends', () => {
  it('shows the same capped S the Fire action writes', () => {
    expect(fireButtonPowerS({ enabled: true, maxPowerPercent: 1 }, 1000)).toBe(10);
    expect(fireButtonPowerS({ enabled: true, maxPowerPercent: 2.5 }, 1000)).toBe(25);
    expect(fireButtonPowerS({ enabled: true, maxPowerPercent: 1 }, 255)).toBe(3);
  });

  it('never shows or sends more than the absolute 5% ceiling', () => {
    const bypassed = { enabled: true, maxPowerPercent: 50 };
    expect(fireButtonPercent(bypassed)).toBe(5);
    expect(fireButtonPowerS(bypassed, 1000)).toBe(50);
  });

  it('flags a power that rounds to S0 on a small S scale', () => {
    const low = { enabled: true, maxPowerPercent: 0.1 };
    expect(firePowerIssue(low, 1000)).toBeNull();
    expect(firePowerIssue(low, 255)).toBe(
      "Fire power 0.1% rounds to S0 on this machine's S255 scale, which cannot light the beam.",
    );
  });

  it('formats percents without float noise', () => {
    expect(formatFirePercent(1)).toBe('1');
    expect(formatFirePercent(0.1 + 0.2)).toBe('0.3');
    expect(formatFirePercent(2.25)).toBe('2.25');
  });
});
