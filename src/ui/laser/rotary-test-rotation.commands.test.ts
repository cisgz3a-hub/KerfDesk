// The exact controller text of a Test rotation on every jog-capable driver
// (ADR-373): the two turns are the driver's own jog, out and back by the same
// distance, and none of them can switch the laser on.

import { describe, expect, it } from 'vitest';
import {
  fluidncDriver,
  grblDriver,
  grblHalDriver,
  marlinDriver,
  smoothiewareDriver,
  type ControllerDriver,
} from '../../core/controllers';
import { withFalconCommandContract } from '../../core/controllers/falcon-command-contract';
import { DEFAULT_ROTARY_SETUP, type RotarySetup } from '../../core/devices';
import { planRotaryTestRotation } from './rotary-test-rotation';

const MEASURED_ROLLER: RotarySetup = {
  ...DEFAULT_ROTARY_SETUP,
  enabled: true,
  mmPerRotation: 40,
  rollerDiameterMm: 25,
};

// M3/M4 or a nonzero S word would ask for beam power.
const LASER_ON_WORD = /\bM0*[34]\b|S0*[1-9]/i;

function turns(driver: ControllerDriver): string[] {
  const plan = planRotaryTestRotation(MEASURED_ROLLER, 'drive', 6000);
  if (plan === null) throw new Error('Expected a plan');
  return plan.legs.map((leg) => driver.commands.buildJog(leg));
}

describe('test rotation controller text', () => {
  it.each<[string, ControllerDriver]>([
    ['GRBL', grblDriver],
    ['grblHAL', grblHalDriver],
    ['FluidNC', fluidncDriver],
  ])('%s turns with two $J jogs', (_name, driver) => {
    expect(turns(driver)).toEqual(['$J=G91 G21 Y40.000 F240', '$J=G91 G21 Y-40.000 F240']);
  });

  it('Marlin turns with relative G0 moves and restores absolute mode', () => {
    expect(turns(marlinDriver)).toEqual([
      'G21\nG91\nG0 Y40.000 F240\nG90',
      'G21\nG91\nG0 Y-40.000 F240\nG90',
    ]);
  });

  it('Smoothieware asserts tool-off and keeps its modal state around each turn', () => {
    const [out, back] = turns(smoothiewareDriver);
    expect(out).toBe('fire off\nM400\nM221 S0\nM5\nM9\nM120\nG21\nG91\nG0 Y40.000 F240\nG90\nM121');
    expect(back).toBe(out?.replace('Y40.000', 'Y-40.000'));
  });

  it('the Falcon contract turns with tool-off G1 S0 moves', () => {
    expect(turns(withFalconCommandContract(grblHalDriver))).toEqual([
      'M5\nG21 G91\nG1 Y40.000 F240 S0\nG90',
      'M5\nG21 G91\nG1 Y-40.000 F240 S0\nG90',
    ]);
  });

  it.each<[string, ControllerDriver]>([
    ['GRBL', grblDriver],
    ['Marlin', marlinDriver],
    ['Smoothieware', smoothiewareDriver],
    ['Falcon', withFalconCommandContract(grblHalDriver)],
  ])('%s never asks for beam power during the test', (_name, driver) => {
    for (const text of turns(driver)) expect(text).not.toMatch(LASER_ON_WORD);
  });
});
