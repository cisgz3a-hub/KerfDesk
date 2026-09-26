import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import {
  projectInspectionContext as contextWithTiming,
  withDeviceTiming,
  type GcodeInspectionContext,
} from './gcode-inspection-source';

const LIMITS = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };

// Machine kind and power dialect only; timing has its own tests below.
function projectInspectionContext(project: Project): GcodeInspectionContext {
  const { timing: _timing, ...context } = contextWithTiming(project);
  return context;
}

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

  it('selects native Smoothie power only for the compiled laser profile', () => {
    const project = createProject();
    const device = { ...project.device, controllerKind: 'smoothieware' as const };
    expect(projectInspectionContext({ ...project, device })).toEqual({
      machineKind: 'laser',
      laserPowerControl: 'smoothieware',
    });
    expect(
      projectInspectionContext({ ...project, device, machine: DEFAULT_CNC_MACHINE_CONFIG }),
    ).toEqual({ machineKind: 'cnc' });
  });
});

describe('Inspector timing context (ADR-425)', () => {
  it('times compiled programs against the device limits and calibration Job Review uses', () => {
    const project = createProject();
    const device = {
      ...project.device,
      name: 'Shop laser',
      accelMmPerSec2: 2500,
      junctionDeviationMm: 0.02,
      maxFeed: 12000,
      estimateCutTimeScale: 1.1,
    };
    const expected = {
      limits: { accelMmPerSec2: 2500, junctionDeviationMm: 0.02, maxFeedMmPerMin: 12000 },
      cutTimeScale: 1.1,
      deviceName: 'Shop laser',
    };
    expect(contextWithTiming({ ...project, device }).timing).toEqual(expected);
    expect(
      contextWithTiming({ ...project, device, machine: DEFAULT_CNC_MACHINE_CONFIG }).timing,
    ).toEqual(expected);
  });

  it('times an opened file for the current device without inferring its machine kind', () => {
    const device = { ...createProject().device, name: 'Shop laser' };
    const opened = withDeviceTiming({ kind: 'text', text: 'G1 X1' }, device);
    expect(opened.machineKind).toBeUndefined();
    expect(opened.timing?.deviceName).toBe('Shop laser');
    const compiled = {
      ...opened,
      timing: { limits: { ...LIMITS }, deviceName: 'Compiled for' },
    };
    expect(withDeviceTiming(compiled, device)).toBe(compiled);
  });
});
