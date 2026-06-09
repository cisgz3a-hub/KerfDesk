import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

function vectorProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 9 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

function hugeRasterProject(): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, raster), {
      ...createLayer({ id: color, color, mode: 'image' }),
      linesPerMm: 25,
    }),
  };
}

describe('prepareOutput', () => {
  it('returns an optimized job for a well-formed project', () => {
    const prepared = prepareOutput(vectorProject());
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.job.groups.length).toBeGreaterThan(0);
  });

  it('defaults to reducing travel moves inside cut groups', () => {
    const prepared = prepareOutput(travelOptimizationProject());

    expect(firstCutSegmentStart(prepared)).toEqual({ x: 0, y: 0 });
  });

  it('preserves source cut order when reduce travel moves is disabled', () => {
    const project = {
      ...travelOptimizationProject(),
      optimization: { reduceTravelMoves: false },
    };

    const prepared = prepareOutput(project);

    expect(firstCutSegmentStart(prepared)).toEqual({ x: 100, y: 300 });
  });

  it('refuses an over-budget raster (ok:false) without producing a job', () => {
    const prepared = prepareOutput(hugeRasterProject());
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.preflight.issues.some((i) => i.code === 'raster-too-large')).toBe(true);
    }
  });

  it('is deterministic — the same project yields the same job', () => {
    const project = vectorProject();
    expect(prepareOutput(project)).toEqual(prepareOutput(project));
  });
});

function travelOptimizationProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'travel.svg',
    bounds: { minX: 0, minY: 100, maxX: 101, maxY: 400 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 100, y: 100 },
              { x: 101, y: 100 },
            ],
            closed: false,
          },
          {
            points: [
              { x: 0, y: 400 },
              { x: 1, y: 400 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

function firstCutSegmentStart(prepared: ReturnType<typeof prepareOutput>): {
  x: number;
  y: number;
} {
  if (!prepared.ok) throw new Error('expected prepared output');
  const group = prepared.job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected first group to be a cut group');
  const first = group.segments[0]?.polyline[0];
  if (first === undefined) throw new Error('expected first cut segment');
  return first;
}
