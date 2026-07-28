import { describe, expect, it } from 'vitest';

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { runPreflight } from '../preflight';
import { grblStrategy } from '../output/grbl-strategy';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import { computeFrameBounds } from './frame-bounds';
import { applyJobOrigin, USER_ORIGIN_JOB_PLACEMENT } from './job-origin';
import { offsetFillDiagnostics } from './offset-fill-diagnostics';
import { optimizePaths } from './optimize-paths';
import { buildToolpath } from './toolpath';

const LAYER_NAME = 'Fill Only';
const PASS_LIMIT = 2000;
const SIZE_MM = 300;
const SPACING_MM = 0.05;

describe('offsetFillDiagnostics', () => {
  it('maps every termination kind to its advisory-only compile diagnostic', () => {
    expect(offsetFillDiagnostics({ kind: 'complete' }, LAYER_NAME)).toEqual([]);
    expect(offsetFillDiagnostics({ kind: 'offset-failed' }, LAYER_NAME)).toEqual([
      { kind: 'offset-fill-failed', layerName: LAYER_NAME },
    ]);
    expect(
      offsetFillDiagnostics({ kind: 'pass-limit', passLimit: PASS_LIMIT }, LAYER_NAME),
    ).toEqual([{ kind: 'offset-fill-pass-limit', layerName: LAYER_NAME, passLimit: PASS_LIMIT }]);
  });

  it('keeps a pass-limited fill previewable and emit-ready with frame bounds', () => {
    const project = passLimitedProject();
    const compiled = compileJob(project.scene, project.device);
    const prepared = optimizePaths(
      applyJobOrigin(compiled, USER_ORIGIN_JOB_PLACEMENT, project.device),
      project.optimization,
      project.device.scanningOffsets,
    );

    expect(prepared.diagnostics).toEqual([
      { kind: 'offset-fill-pass-limit', layerName: LAYER_NAME, passLimit: PASS_LIMIT },
    ]);
    expect(buildToolpath(prepared).totalLength).toBeGreaterThan(0);
    expect(
      computeFrameBounds(project.scene, project.device, {
        jobOrigin: USER_ORIGIN_JOB_PLACEMENT,
      }),
    ).not.toBeNull();

    const gcode = grblStrategy.emit(prepared, project.device);
    expect(gcode).not.toBe('');
    expect(runPreflight(project, gcode).issues).toEqual([]);
  });
});

function passLimitedProject(): Project {
  const color = '#ff0000';
  const square: SceneObject = {
    kind: 'imported-svg',
    id: 'pass-limited-square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: SIZE_MM, maxY: SIZE_MM },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: SIZE_MM, y: 0 },
              { x: SIZE_MM, y: SIZE_MM },
              { x: 0, y: SIZE_MM },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  return {
    ...base,
    scene: {
      objects: [square],
      layers: [
        {
          ...createLayer({ id: 'offset-fill', name: LAYER_NAME, color }),
          mode: 'fill',
          fillStyle: 'offset',
          hatchSpacingMm: SPACING_MM,
        },
      ],
    },
  };
}
