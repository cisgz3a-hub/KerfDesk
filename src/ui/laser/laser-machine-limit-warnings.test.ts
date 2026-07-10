import { describe, expect, it } from 'vitest';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Layer,
  type Project,
} from '../../core/scene';
import { detectLaserMachineLimitWarnings } from './laser-machine-limit-warnings';

// Default laser device bed is 400 × 400 mm (device-profile.ts).
function laserProject(args: {
  readonly bedWidth?: number;
  readonly bedHeight?: number;
  readonly speed?: number;
  readonly output?: boolean;
}): Project {
  const base = createProject();
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    output: args.output ?? true,
    ...(args.speed === undefined ? {} : { speed: args.speed }),
  };
  return {
    ...base,
    device: {
      ...base.device,
      ...(args.bedWidth === undefined ? {} : { bedWidth: args.bedWidth }),
      ...(args.bedHeight === undefined ? {} : { bedHeight: args.bedHeight }),
    },
    scene: { objects: [], layers: [layer] },
  };
}

const REPORTED: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400, maxFeed: 6000 };

describe('detectLaserMachineLimitWarnings (DEV-06)', () => {
  it('is silent when no controller is connected (limits null)', () => {
    expect(detectLaserMachineLimitWarnings(laserProject({ bedWidth: 900 }), null)).toEqual([]);
  });

  it('is silent for a CNC project (the CNC detector owns that kind)', () => {
    const cnc: Project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(detectLaserMachineLimitWarnings(cnc, REPORTED)).toEqual([]);
  });

  it('warns when the profile work area exceeds the reported travel', () => {
    const warnings = detectLaserMachineLimitWarnings(laserProject({ bedWidth: 500 }), REPORTED);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/exceeds the machine's reported travel/);
    expect(warnings[0]).toMatch(/width 500 mm > 400 mm/);
  });

  it('does not nag when the profile bed matches the reported travel (within tolerance)', () => {
    expect(detectLaserMachineLimitWarnings(laserProject({ bedWidth: 400 }), REPORTED)).toEqual([]);
  });

  it('warns when the fastest output-layer speed exceeds the reported max rate', () => {
    const warnings = detectLaserMachineLimitWarnings(
      laserProject({ speed: 8000, output: true }),
      REPORTED,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/speed 8000 mm\/min is above the machine's reported max rate/);
  });

  it('ignores the speed of layers with output off', () => {
    expect(
      detectLaserMachineLimitWarnings(laserProject({ speed: 8000, output: false }), REPORTED),
    ).toEqual([]);
  });
});
