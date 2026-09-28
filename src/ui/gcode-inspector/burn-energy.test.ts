import { describe, expect, it } from 'vitest';
import {
  ASSUMED_OPTICAL_POWER_W,
  doseDensity,
  FULL_BURN_DOSE_J_PER_MM2,
  lightAfter,
  passDoseJPerMm2,
  powerDensity,
  type BurnPass,
} from './burn-energy';

const TEN_WATT = { opticalPowerW: ASSUMED_OPTICAL_POWER_W, beamMm: 0.1 };
const WOOD = FULL_BURN_DOSE_J_PER_MM2.wood;

function light(pass: BurnPass, fullDose = WOOD): number {
  return lightAfter(doseDensity(passDoseJPerMm2(TEN_WATT, pass), fullDose));
}

describe('burn energy (ADR-501)', () => {
  it('puts power over speed and beam width into each square millimetre', () => {
    // 10 W at full power, 50 mm/s, 0.1 mm beam: 2 J/mm².
    expect(passDoseJPerMm2(TEN_WATT, { power: 1, feedMmPerMin: 3000 })).toBeCloseTo(2);
    expect(passDoseJPerMm2(TEN_WATT, { power: 0.5, feedMmPerMin: 3000 })).toBeCloseTo(1);
    expect(passDoseJPerMm2(TEN_WATT, { power: 1, feedMmPerMin: 6000 })).toBeCloseTo(1);
    expect(
      passDoseJPerMm2({ opticalPowerW: 20, beamMm: 0.2 }, { power: 1, feedMmPerMin: 3000 }),
    ).toBeCloseTo(2);
  });

  it('puts nothing in with the laser off, no speed or no beam', () => {
    expect(passDoseJPerMm2(TEN_WATT, { power: 0, feedMmPerMin: 3000 })).toBe(0);
    expect(passDoseJPerMm2(TEN_WATT, { power: 1, feedMmPerMin: 0 })).toBe(0);
    expect(passDoseJPerMm2({ opticalPowerW: 10, beamMm: 0 }, { power: 1, feedMmPerMin: 1 })).toBe(
      0,
    );
    expect(passDoseJPerMm2(TEN_WATT, { power: Number.NaN, feedMmPerMin: 3000 })).toBe(0);
  });

  it('darkens wood as the power-only shading does at 10 W and 3000 mm/min', () => {
    for (const power of [1, 0.5, 0.3]) {
      expect(light({ power, feedMmPerMin: 3000 })).toBeCloseTo(lightAfter(powerDensity(power)));
    }
    expect(light({ power: 1, feedMmPerMin: 3000 })).toBeCloseTo(0.08);
    expect(light({ power: 0.3, feedMmPerMin: 3000 })).toBeCloseTo(0.724);
  });

  it('burns darker slower, and the same at twice the power and twice the speed', () => {
    const fast = light({ power: 0.3, feedMmPerMin: 3000 });
    expect(light({ power: 0.3, feedMmPerMin: 1000 })).toBeLessThan(fast);
    expect(light({ power: 0.6, feedMmPerMin: 6000 })).toBeCloseTo(fast);
  });

  it('keeps darkening past the full dose, down to 2% of the light', () => {
    expect(light({ power: 1, feedMmPerMin: 1000 })).toBeCloseTo(0.02);
    expect(lightAfter(doseDensity(100, WOOD))).toBeCloseTo(0.02);
  });

  it('adds passes as optical densities', () => {
    const one = doseDensity(1, WOOD);
    expect(lightAfter(one + one)).toBeCloseTo(lightAfter(one) ** 2);
  });

  it('needs more energy to mark acrylic than wood, and less for MDF', () => {
    const pass = { power: 0.5, feedMmPerMin: 3000 };
    expect(light(pass, FULL_BURN_DOSE_J_PER_MM2.acrylic)).toBeGreaterThan(light(pass));
    expect(light(pass, FULL_BURN_DOSE_J_PER_MM2.mdf)).toBeLessThan(light(pass));
  });
});
