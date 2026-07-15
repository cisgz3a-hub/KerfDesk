import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncMachineConfig,
} from '../scene';
import { runCncPreflight } from './cnc-preflight';

const GCODE = [
  'G21',
  'G90',
  'G54',
  'G94',
  'G0 Z3.810',
  'M3 S12000',
  'G4 P3.000',
  'G0 X10.000 Y10.000',
  'G1 Z-1.000 F300',
  'G1 X20.000 Y10.000 F1000',
  'G0 Z3.810',
  'M5',
].join('\n');

function projectWithOutput() {
  const project = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: DEFAULT_CNC_LAYER_SETTINGS,
  };
  return { ...project, scene: { ...project.scene, layers: [layer] } };
}

function configWithSpinup(spindleSpinupSec: number): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleSpinupSec },
  };
}

describe('CNC spindle spin-up preflight', () => {
  it.each([-1, Number.NaN])('blocks an invalid %s second dwell', (spinupSec) => {
    const result = runCncPreflight(projectWithOutput(), configWithSpinup(spinupSec), GCODE);

    expect(result.issues).toContainEqual({
      code: 'cnc-settings-invalid',
      message: 'CNC spindle spin-up delay must be a finite number at or above 0 seconds.',
    });
  });

  it.each([0, 0.1, 0.499])('accepts a machine-specific %s second dwell', (spinupSec) => {
    const result = runCncPreflight(projectWithOutput(), configWithSpinup(spinupSec), GCODE);

    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('spindle spin-up delay') }),
    );
  });
});
