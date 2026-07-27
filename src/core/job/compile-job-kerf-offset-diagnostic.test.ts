import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type SceneObject } from '../scene';

// Line mode's kerf compensation had the same silent-loss shape the offset fill
// had before it was fixed: a clipper2 failure was flattened to an empty list, so
// every kerf-compensated closed contour vanished from the cut with nothing
// reported. The job still compiled, still framed, and still ran — it just did
// not cut the part. The checked variant keeps the failure so compileJob can
// report it.
const offsetCheckedMock = vi.hoisted(() => vi.fn());

vi.mock('../geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerf: () => [],
  offsetClosedPolylinesForKerfChecked: offsetCheckedMock,
}));

const { compileJob } = await import('./compile-job');

const COLOR = '#ff0000';
const LAYER_NAME = 'Cut';
const KERF_OFFSET_MM = 0.1;

function kerfLineScene(): Scene {
  const layer = {
    ...createLayer({ id: 'cut-layer', name: LAYER_NAME, color: COLOR }),
    mode: 'line' as const,
    output: true,
    visible: true,
    kerfOffsetMm: KERF_OFFSET_MM,
  };
  const square: SceneObject = {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  return { layers: [layer], objects: [square] };
}

function failOffset(): void {
  offsetCheckedMock.mockImplementation(() => ({
    kind: 'error',
    error: { kind: 'operation-failed', message: 'clipper2: pathological geometry' },
  }));
}

function succeedOffset(): void {
  offsetCheckedMock.mockImplementation(() => ({
    kind: 'ok',
    value: [
      {
        points: [
          { x: -0.1, y: -0.1 },
          { x: 20.1, y: -0.1 },
          { x: 20.1, y: 20.1 },
          { x: -0.1, y: 20.1 },
        ],
        closed: true,
      },
    ],
  }));
}

describe('compileJob kerf-offset diagnostics', () => {
  it('reports the failed layer by name even though the cut left no group behind', () => {
    failOffset();

    const job = compileJob(kerfLineScene(), DEFAULT_DEVICE_PROFILE);

    // No segments means no cut group, so without the diagnostic this layer
    // disappeared from the job with nothing surfaced anywhere.
    expect(job.groups.filter((group) => group.kind === 'cut')).toEqual([]);
    expect(job.diagnostics).toEqual([{ kind: 'kerf-offset-failed', layerName: LAYER_NAME }]);
  });

  it('leaves diagnostics off the job entirely when the kerf offset succeeds', () => {
    succeedOffset();

    const job = compileJob(kerfLineScene(), DEFAULT_DEVICE_PROFILE);

    expect(job.groups.filter((group) => group.kind === 'cut')).toHaveLength(1);
    expect(job.diagnostics).toBeUndefined();
  });

  it('keeps the contours the kerf offset never touched when the offset fails', () => {
    // The object mixes an open contour (never kerf-compensated) with a closed
    // one. The open contour must survive the failure — losing the whole layer
    // would be a bigger regression than the bug being fixed.
    failOffset();
    const scene = kerfLineScene();
    const object = scene.objects[0];
    if (object === undefined || !('paths' in object)) throw new Error('fixture changed');
    const withOpen: SceneObject = {
      ...object,
      paths: [
        {
          color: COLOR,
          polylines: [
            ...(object.paths[0]?.polylines ?? []),
            {
              points: [
                { x: 0, y: 30 },
                { x: 20, y: 30 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };

    const job = compileJob({ ...scene, objects: [withOpen] }, DEFAULT_DEVICE_PROFILE);

    expect(job.groups.filter((group) => group.kind === 'cut')).toHaveLength(1);
    expect(job.diagnostics).toEqual([{ kind: 'kerf-offset-failed', layerName: LAYER_NAME }]);
  });
});
