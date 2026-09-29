// Second CNC audit P2-gcode-1 and JR-3: nothing compared a job's Z range, from
// its deepest cut up to the ADR-491 park height lift, with the Z travel.
import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncMachineConfig,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { detectCncZTravelWarnings } from './cnc-z-travel-warnings';

const SQUARE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 50, minY: 50, maxX: 90, maxY: 90 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 50, y: 50 },
            { x: 90, y: 50 },
            { x: 90, y: 90 },
            { x: 50, y: 90 },
          ],
        },
      ],
    },
  ],
};

function job(args: { readonly depthMm: number; readonly parkZMm?: number }): {
  readonly project: Project;
  readonly job: Job;
} {
  const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, zTravelMm: 75 };
  const machine: CncMachineConfig = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    params: {
      ...DEFAULT_CNC_MACHINE_CONFIG.params,
      ...(args.parkZMm === undefined ? {} : { parkZMm: args.parkZMm }),
    },
  };
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: args.depthMm,
      depthPerPassMm: 3,
      tabsEnabled: false,
    },
  };
  const project: Project = {
    ...createProject(device),
    machine,
    scene: { objects: [SQUARE], layers: [layer] },
  };
  return { project, job: compileCncJob(project.scene, device, machine) };
}

describe('detectCncZTravelWarnings', () => {
  it('warns when the park height lift and the deepest cut do not fit in the Z travel', () => {
    const { project, job: compiled } = job({ depthMm: 6, parkZMm: 120 });

    expect(detectCncZTravelWarnings(project, null, compiled)).toEqual([
      'This job needs 126 mm of Z, from its deepest cut at Z-6 up to the park height lift at ' +
        'Z120, but the machine profile records 75 mm of Z travel. No work zero fits both: Z ' +
        'runs into a stop, where it can stall and lose steps so later cuts run deeper. Lower ' +
        'the park height or cut less deep.',
    ]);
  });

  it('is silent when the range fits', () => {
    const { project, job: compiled } = job({ depthMm: 6, parkZMm: 30 });

    expect(detectCncZTravelWarnings(project, null, compiled)).toEqual([]);
  });

  it('prefers the Z travel the controller reports ($132)', () => {
    const { project, job: compiled } = job({ depthMm: 6, parkZMm: 30 });

    const [warning] = detectCncZTravelWarnings(project, { zTravelMm: 30 }, compiled);
    expect(warning).toContain('the controller reports ($132) 30 mm of Z travel');
  });

  it('names the safe Z when a deep job alone overruns the travel', () => {
    const { project, job: compiled } = job({ depthMm: 80 });

    const [warning] = detectCncZTravelWarnings(project, null, compiled);
    expect(warning).toContain('from its deepest cut at Z-80 up to the safe Z lift at Z3.8');
  });

  it('is silent when no Z travel is known', () => {
    const { project, job: compiled } = job({ depthMm: 6, parkZMm: 120 });
    const { zTravelMm: _recorded, ...device } = project.device;
    const unknown: Project = { ...project, device };

    expect(detectCncZTravelWarnings(unknown, null, compiled)).toEqual([]);
  });
});
