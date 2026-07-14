import { describe, expect, it } from 'vitest';
import { USER_ORIGIN_JOB_PLACEMENT } from '../../core/job';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type OutputScope,
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

function streamableRasterProject(): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'streamed',
    color,
    source: 'line-art.png',
    dataUrl: 'data:image/png;base64,source',
    lumaBase64: 'AA==',
    pixelWidth: 1,
    pixelHeight: 1,
    dither: 'threshold',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: 201, maxY: 201 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, raster), {
      ...createLayer({ id: color, color, mode: 'image' }),
      ditherAlgorithm: 'threshold',
      linesPerMm: 10,
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
    const base = travelOptimizationProject();
    const project: Project = {
      ...base,
      optimization: {
        ...base.optimization,
        reduceTravelMoves: false,
        travelPolicy: 'source-order',
      },
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

  it('prepares a measured-safe raster above the former four-million-pixel ceiling', () => {
    const prepared = prepareOutput(streamableRasterProject());

    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      const raster = prepared.job.groups.find((group) => group.kind === 'raster');
      expect(raster).toMatchObject({ pixelWidth: 2010, pixelHeight: 2010 });
      expect(raster?.kind === 'raster' ? raster.sValues.length : -1).toBe(0);
      expect(raster?.kind === 'raster' ? raster.rowProvider : undefined).toBeTypeOf('function');
    }
  });

  it('compiles only selected objects when Cut Selected Graphics is enabled', () => {
    const prepared = prepareOutput(twoObjectProject(), { outputScope: selectedScope(['B']) });

    expect(cutSegmentStarts(prepared)).toEqual([{ x: 120, y: 400 }]);
  });

  it('returns a scoped preflight failure when Cut Selected Graphics has no selection', () => {
    const prepared = prepareOutput(twoObjectProject(), { outputScope: selectedScope([]) });

    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.preflight.issues).toEqual([
        {
          code: 'selected-output-empty',
          message:
            'Selected artwork only is enabled, but no artwork is selected. Select artwork or turn off Selected artwork only.',
        },
      ]);
    }
  });

  it('uses selected bounds for origin when Use Selection Origin is enabled', () => {
    const prepared = prepareOutput(twoObjectProject(), {
      jobOrigin: USER_ORIGIN_JOB_PLACEMENT,
      outputScope: { ...selectedScope(['B']), useSelectionOrigin: true },
    });

    expect(cutSegmentStarts(prepared)).toEqual([{ x: 0, y: 0 }]);
  });

  it('uses full-design bounds for origin when Use Selection Origin is disabled', () => {
    const prepared = prepareOutput(twoObjectProject(), {
      jobOrigin: USER_ORIGIN_JOB_PLACEMENT,
      outputScope: { ...selectedScope(['B']), useSelectionOrigin: false },
    });

    expect(cutSegmentStarts(prepared)).toEqual([{ x: 110, y: 0 }]);
  });

  it('is deterministic - the same project yields the same job', () => {
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

function cutSegmentStarts(prepared: ReturnType<typeof prepareOutput>): ReadonlyArray<{
  readonly x: number;
  readonly y: number;
}> {
  if (!prepared.ok) throw new Error('expected prepared output');
  return prepared.job.groups.flatMap((group) => {
    if (group.kind !== 'cut') return [];
    return group.segments.map((segment) => {
      const first = segment.polyline[0];
      if (first === undefined) throw new Error('expected segment start');
      return first;
    });
  });
}

function twoObjectProject(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      layers: [createLayer({ id: 'L1', color: '#ff0000' })],
      objects: [lineObject('A', 10), lineObject('B', 120)],
    },
  };
}

function lineObject(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

function selectedScope(selectedObjectIds: ReadonlyArray<string>): OutputScope {
  return {
    cutSelectedGraphics: true,
    useSelectionOrigin: false,
    selectedObjectIds,
  };
}
