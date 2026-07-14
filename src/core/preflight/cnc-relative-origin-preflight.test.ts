import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type Project,
} from '../scene';
import { runCncPreflight } from './cnc-preflight';

const FITTING_RELATIVE_GCODE = [
  'G21',
  'G90',
  'G94',
  'M3 S12000',
  'G0 Z3.810',
  'G0 X-10.000 Y-10.000',
  'G1 Z-1.000 F300',
  'G1 X10.000 Y-10.000 F1000',
  'G1 X10.000 Y10.000',
  'G1 X-10.000 Y10.000',
  'G1 X-10.000 Y-10.000',
  'G0 Z3.810',
  'M5',
].join('\n');

describe('CNC relative-origin bounds', () => {
  it('accepts negative work coordinates when the complete motion span fits the bed', () => {
    const result = runCncPreflight(
      projectWithCnc(),
      DEFAULT_CNC_MACHINE_CONFIG,
      FITTING_RELATIVE_GCODE,
      {
        coordinateMode: 'relative-origin',
      },
    );

    expect(result.issues.filter((issue) => issue.code === 'out-of-bed')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('still refuses a relative motion span wider than the bed', () => {
    const oversized = FITTING_RELATIVE_GCODE.replace('G1 X10.000 Y10.000', 'G1 X500.000 Y10.000');
    const result = runCncPreflight(projectWithCnc(), DEFAULT_CNC_MACHINE_CONFIG, oversized, {
      coordinateMode: 'relative-origin',
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'out-of-bed',
        message: expect.stringContaining('Relative job motion spans'),
      }),
    );
  });
});

function projectWithCnc(): Project {
  const project = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: DEFAULT_CNC_LAYER_SETTINGS,
  };
  return { ...project, scene: { ...project.scene, layers: [layer] } };
}
