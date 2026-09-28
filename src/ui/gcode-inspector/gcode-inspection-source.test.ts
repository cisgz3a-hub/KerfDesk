import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import {
  projectInspectionContext as contextWithTiming,
  withCurrentDevice,
  type GcodeInspectionContext,
} from './gcode-inspection-source';

const LIMITS = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };

// Machine kind and power dialect only; timing, the design and the laser have their own tests.
function projectInspectionContext(project: Project): GcodeInspectionContext {
  const {
    timing: _timing,
    design: _design,
    laser: _laser,
    ...context
  } = contextWithTiming(project);
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

describe('Inspector design context (ADR-487)', () => {
  it("carries a CNC project's stock, and its reliefs where Save placed them", () => {
    const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const stock = DEFAULT_CNC_MACHINE_CONFIG.stock;
    expect(contextWithTiming(project).design).toEqual({
      stockThicknessMm: stock.thicknessMm,
      ...(stock.materialKey === undefined ? {} : { stockMaterialKey: stock.materialKey }),
      reliefs: [],
    });
    expect(contextWithTiming(createProject()).design).toBeUndefined();
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
    const opened = withCurrentDevice({ kind: 'text', text: 'G1 X1' }, device);
    expect(opened.machineKind).toBeUndefined();
    expect(opened.timing?.deviceName).toBe('Shop laser');
    expect(opened.laser?.maxPowerS).toBe(device.maxPowerS);
    const compiled = {
      ...opened,
      timing: { limits: { ...LIMITS }, deviceName: 'Compiled for' },
    };
    expect(withCurrentDevice(compiled, device)).toBe(compiled);
  });
});

describe('Inspector laser context (ADR-487)', () => {
  it("burns a laser project's program at its full power and beam, on its rotary when on", () => {
    const project = createProject();
    const device = {
      ...project.device,
      maxPowerS: 255,
      laserSubProfile: {
        model: 'Test head',
        focusMode: 'manual' as const,
        airAssist: 'none' as const,
        spotSizeMm: { x: 0.08, y: 0.12 },
      },
    };
    expect(contextWithTiming({ ...project, device }).laser).toEqual({
      maxPowerS: 255,
      spotMm: 0.1,
    });
    const rotary = {
      enabled: true,
      type: 'chuck' as const,
      mmPerRotation: 360,
      objectDiameterMm: 50,
    };
    const turned = contextWithTiming({ ...project, device: { ...device, rotary } }).laser;
    expect(turned?.rotary?.diameterMm).toBe(50);
    // A chuck turns the work once in its own mm a rotation.
    expect(turned?.rotary?.wrapYMm).toBeCloseTo(360, 9);
    const off = { ...rotary, enabled: false };
    expect(
      contextWithTiming({ ...project, device: { ...device, rotary: off } }).laser?.rotary,
    ).toBeUndefined();
    expect(
      contextWithTiming({ ...project, machine: DEFAULT_CNC_MACHINE_CONFIG }).laser,
    ).toBeUndefined();
  });
});
