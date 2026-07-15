import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { compileJob } from '../job';
import { grblStrategy } from '../output';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { runPreflight } from './preflight';

function emit(project: Project): string {
  return grblStrategy.emit(compileJob(project.scene, project.device), project.device);
}

function neotronicsFineDetailFillProject(
  fillStyle: 'scanline' | 'island',
  fillOverscanMm = 5,
): Project {
  return fineDetailFillProject(fillStyle, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, fillOverscanMm);
}

function genericFineDetailFillProject(fillStyle: 'scanline' | 'island'): Project {
  return fineDetailFillProject(fillStyle, DEFAULT_DEVICE_PROFILE, 5);
}

function customSafeDialectFineDetailFillProject(
  fillStyle: 'scanline' | 'island',
  fillOverscanMm = 5,
): Project {
  return fineDetailFillProject(
    fillStyle,
    {
      ...DEFAULT_DEVICE_PROFILE,
      profileId: 'custom-safe-dialect',
      machineFamily: 'custom-grbl',
      gcodeDialect: { dialectId: 'neotronics-4040-safe' },
    },
    fillOverscanMm,
  );
}

function fineDetailFillProject(
  fillStyle: 'scanline' | 'island',
  device: Project['device'],
  fillOverscanMm: number,
): Project {
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'tiny-island',
    source: 'tiny-island.svg',
    bounds: { minX: 20, minY: 20, maxX: 23, maxY: 23 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 20, y: 20 },
              { x: 23, y: 20 },
              { x: 23, y: 23 },
              { x: 20, y: 23 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  return {
    ...createProject(device),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#ff0000', mode: 'fill' }),
          fillStyle,
          fillOverscanMm,
          hatchSpacingMm: 1,
          power: 10,
        },
      ],
    },
  };
}

describe('Island Fill preflight', () => {
  it('allows 4040 Island Fill jobs with short sweeps when overscan is enabled', () => {
    const project = neotronicsFineDetailFillProject('island');
    const result = runPreflight(project, emit(project));
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('does not block 4040 Island Fill when overscan is disabled', () => {
    const project = neotronicsFineDetailFillProject('island', 0);
    const result = runPreflight(project, emit(project));
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('does not block safe-dialect custom profiles when Island Fill overscan is disabled', () => {
    const project = customSafeDialectFineDetailFillProject('island', 0);
    const result = runPreflight(project, emit(project));
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('allows the same 4040 fine-detail geometry with Scanline Fill', () => {
    const project = neotronicsFineDetailFillProject('scanline');
    const result = runPreflight(project, emit(project));
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('does not block Island Fill on other GRBL profiles', () => {
    const project = genericFineDetailFillProject('island');
    const result = runPreflight(project, emit(project));
    expect(result).toEqual({ ok: true, issues: [] });
  });
});
