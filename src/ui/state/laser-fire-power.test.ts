import { describe, expect, it } from 'vitest';
import { currentFirePowerS } from './laser-fire-power';

const control = { enabled: true, maxPowerPercent: 5 };
const current = {
  controllerSessionEpoch: 7,
  controllerSettings: { maxPowerS: 255 },
  controllerSettingsObservation: { sessionEpoch: 7, observedAt: 0 },
};

describe('current low-power commanded S ceiling', () => {
  it('clamps a saved S1000 profile to a same-session observed S255 controller', () => {
    expect(currentFirePowerS(current, control, 1000, 5)).toBe(12);
    expect(currentFirePowerS(current, control, 1000, 1)).toBe(2);
  });
  it('does not use an old controller session to qualify the current range', () => {
    expect(
      currentFirePowerS(
        { ...current, controllerSettingsObservation: { sessionEpoch: 6, observedAt: 0 } },
        control,
        1000,
        5,
      ),
    ).toBe(50);
  });
  it('does not increase the approved profile share for a larger observed range', () => {
    expect(
      currentFirePowerS({ ...current, controllerSettings: { maxPowerS: 2000 } }, control, 1000, 5),
    ).toBe(50);
  });
  it('retains the profile and hard caps and refuses invalid saved scales', () => {
    expect(currentFirePowerS(current, { enabled: true, maxPowerPercent: 0.5 }, 1000, 99)).toBe(1);
    expect(currentFirePowerS(current, control, Number.NaN, 1)).toBe(0);
  });
});
