import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { projectInspectionContext } from './gcode-inspection-source';

describe('compiled Inspector source context', () => {
  it('identifies legacy laser projects and CNC projects without inferring from their G-code', () => {
    const project = createProject();
    expect(projectInspectionContext(project)).toEqual({
      machineKind: 'laser',
      laserPowerControl: 'spindle',
    });
    expect(projectInspectionContext({ ...project, machine: DEFAULT_CNC_MACHINE_CONFIG })).toEqual({
      machineKind: 'cnc',
    });
  });

  it('selects fan power only for the actual Marlin fan dialect', () => {
    const project = createProject();
    const device = {
      ...project.device,
      controllerKind: 'marlin' as const,
      gcodeDialect: { dialectId: 'marlin-fan' as const },
    };
    expect(projectInspectionContext({ ...project, device })).toEqual({
      machineKind: 'laser',
      laserPowerControl: 'fan',
    });
    expect(
      projectInspectionContext({ ...project, device: { ...device, controllerKind: 'grbl-v1.1' } }),
    ).toEqual({ machineKind: 'laser', laserPowerControl: 'spindle' });
  });
});
