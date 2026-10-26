// ADR-567 Amendment 2 (controller audit v4 E1-P2-1): FluidNC drops every S
// fraction, so a speed_map top below 100 cannot give each whole percentage
// its own S. Job Review says which powers collapse.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { fluidncPowerStepWarning } from './fluidnc-power-scale';

const FLUIDNC = { controllerKind: 'fluidnc' } as const;

describe('fluidncPowerStepWarning', () => {
  it('stays quiet from 100 S steps up and on other controllers', () => {
    expect(fluidncPowerStepWarning(FLUIDNC, { maxPowerS: 100, source: 'controller' })).toBeNull();
    expect(fluidncPowerStepWarning(FLUIDNC, { maxPowerS: 255, source: 'profile' })).toBeNull();
    expect(
      fluidncPowerStepWarning(DEFAULT_DEVICE_PROFILE, { maxPowerS: 1, source: 'controller' }),
    ).toBeNull();
    expect(
      fluidncPowerStepWarning({ controllerKind: 'grblhal' }, { maxPowerS: 20, source: 'profile' }),
    ).toBeNull();
  });

  it('says a connected $30=1 burns nothing below 50% and full power from 50%', () => {
    const message = fluidncPowerStepWarning(FLUIDNC, { maxPowerS: 1, source: 'controller' });
    expect(message).toBe(
      "FluidNC keeps every S word as a whole number, and full power here is the connected controller's $30=1, the top of its speed_map. " +
        'Every power below 50% sends S0 and burns nothing, and every power from 50% burns at full power. ' +
        "Set the top of the spindle's speed_map in the FluidNC config to 100 or more (FluidNC's Laser default is 255) before burning, so each whole percentage gets its own S.",
    );
  });

  it('names the step size and the S0 floor for a profile top of 20', () => {
    const message = fluidncPowerStepWarning(FLUIDNC, { maxPowerS: 20, source: 'profile' });
    expect(message).toContain("this profile's Full-power S20");
    expect(message).toContain(
      'Power moves in 5% steps: each power is sent as the nearest whole S, up to 2.5% from the set value, and every power below 2.5% sends S0 and burns nothing.',
    );
  });

  it('rounds the step text for a top of 99', () => {
    const message = fluidncPowerStepWarning(FLUIDNC, { maxPowerS: 99, source: 'controller' });
    expect(message).toContain('Power moves in 1% steps');
    expect(message).toContain('every power below 0.5% sends S0');
  });
});
