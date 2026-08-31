import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import { detectCncContourPrecisionWarnings } from './cnc-contour-precision-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

function group(layerId: string): CncGroup {
  return {
    kind: 'cnc',
    layerId,
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 10, y: 20 },
          { x: 10.0000004, y: 20.0000004 },
          { x: 10, y: 20 },
        ],
        closed: true,
      },
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 40, y: 40 },
          { x: 50, y: 40 },
          { x: 40, y: 40 },
        ],
        closed: true,
      },
    ],
  };
}

function project(): Project {
  const base = createProject();
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [],
      layers: [{ ...createLayer({ id: 'micro', color: '#ff0000' }), name: 'Micro Engrave' }],
    },
  };
}

describe('CNC contour precision warnings', () => {
  it('names a mixed-job contour that exceeds GRBL input representation', () => {
    const job: Job = { groups: [group('micro')] };

    expect(detectCncContourPrecisionWarnings(project(), job)).toEqual([
      expect.stringContaining('CNC layer "Micro Engrave" contains contour detail that cannot'),
    ]);
  });

  it('reaches the shared Save/Start Job Review warning surface without refusing it', () => {
    const currentProject = project();
    const job: Job = { groups: [group('micro')] };
    const warnings = detectMachineJobWarnings(currentProject, null, null, {
      ok: true,
      project: currentProject,
      job,
      jobOriginOffset: { x: 0, y: 0 },
      advisories: [],
    });

    expect(warnings).toContainEqual(
      expect.stringContaining(
        'unrepresentable detail is absent from both Preview and emitted G-code',
      ),
    );
  });

  it.each([10.0004, 10.00004])(
    'does not warn for parser-representable detail ending at %s',
    (detailCoordinate) => {
      const fine = group('micro');
      const first = fine.passes[0];
      if (first?.kind !== 'contour') throw new Error('expected contour');
      const job: Job = {
        groups: [
          {
            ...fine,
            passes: [
              {
                ...first,
                polyline: [
                  { x: 10, y: 20 },
                  { x: detailCoordinate, y: detailCoordinate + 10 },
                  { x: 10, y: 20 },
                ],
              },
            ],
          },
        ],
      };

      expect(detectCncContourPrecisionWarnings(project(), job)).toEqual([]);
    },
  );
});
