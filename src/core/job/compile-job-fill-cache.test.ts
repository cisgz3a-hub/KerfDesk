import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type Scene,
  type SceneObject,
  type TracedImage,
} from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { fillHatchingWithMetadata } from './fill-hatching';
import { compileJob } from './compile-job';

const CALIBRATED_OFFSET_MM = 0.0004;

vi.mock('./fill-hatching', async (importOriginal) => {
  const actual = await importOriginal<{
    fillHatchingWithMetadata: typeof fillHatchingWithMetadata;
  }>();
  return { ...actual, fillHatchingWithMetadata: vi.fn(actual.fillHatchingWithMetadata) };
});

function tracedFillScene(): Scene {
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  return {
    layers: [
      {
        ...createLayer({ id: '#000000', color: '#000000', mode: 'fill' }),
        hatchSpacingMm: 1,
        fillBidirectional: true,
      },
    ],
    objects: [traced],
  };
}

describe('compileJob fill hatch cache', () => {
  beforeEach(() => {
    vi.mocked(fillHatchingWithMetadata).mockClear();
  });

  it('reuses fill hatches across unchanged estimates', () => {
    const scene = tracedFillScene();

    compileJob(scene, DEFAULT_DEVICE_PROFILE);
    compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(1);
  });

  it('passes fillBidirectional to the hatcher and re-hatches when it flips (ADR-038)', () => {
    const base = tracedFillScene();
    const uni: Scene = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, fillBidirectional: false })),
    };

    compileJob(base, DEFAULT_DEVICE_PROFILE); // explicitly bidirectional
    compileJob(uni, DEFAULT_DEVICE_PROFILE); // bidirectional: false

    // The compile path threads the layer flag into fillHatching...
    expect(fillHatchingWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ bidirectional: false }),
    );
    // ...and flipping it is not a cache hit — both directions are computed
    // (the flag is part of both fill cache keys, so a stale snake path can't
    // be reused for a unidirectional layer).
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('computes and caches both hatch angles when cross-hatch is enabled', () => {
    const base = tracedFillScene();
    const cross: Scene = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, fillCrossHatch: true })),
    };

    compileJob(cross, DEFAULT_DEVICE_PROFILE);
    compileJob(cross, DEFAULT_DEVICE_PROFILE);

    expect(fillHatchingWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ hatchAngleDeg: 0, bidirectional: true }),
    );
    expect(fillHatchingWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ hatchAngleDeg: 90, bidirectional: true }),
    );
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('retains a reverse hatch that becomes emittable after calibrated translation', () => {
    const scene = tracedFillScene();
    const layer = scene.layers[0];
    if (layer === undefined) throw new Error('Expected traced fill fixture layer');
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [{ speedMmPerMin: layer.speed, offsetMm: CALIBRATED_OFFSET_MM }],
    };
    vi.mocked(fillHatchingWithMetadata).mockReturnValueOnce([
      {
        points: [
          { x: 10.0004, y: 0 },
          { x: 9.9996, y: 0 },
        ],
        closed: false,
        reverse: true,
      },
    ]);

    const job = compileJob(scene, device);
    const gcode = grblStrategy.emit(job, device);

    expect(job.groups).toHaveLength(1);
    expect(job.diagnostics).toBeUndefined();
    expect(gcode).toContain('G1X9.999Y0');
  });

  it('removes a generic fill group when every hatch collapses at emitted precision', () => {
    const scene = tracedFillScene();
    vi.mocked(fillHatchingWithMetadata).mockReturnValueOnce([
      {
        points: [
          { x: 10.0004, y: 0 },
          { x: 9.9996, y: 0 },
        ],
        closed: false,
        reverse: true,
      },
    ]);

    const job = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    const gcode = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(job.groups).toEqual([]);
    expect(job.diagnostics).toEqual([
      { kind: 'fill-collapsed-at-precision', layerName: 'Operation' },
    ]);
    expect(gcode).not.toMatch(/^G1(?=[^0-9.]|$)/m);
  });
});

function boundTrace(id: string, x = 0, operationIds = ['fill']): TracedImage {
  const object = tracedFillScene().objects[0];
  if (object?.kind !== 'traced-image') throw new Error('Expected traced Fill artwork');
  return { ...object, id, operationIds, transform: { ...IDENTITY_TRANSFORM, x } };
}

function cacheScene(objects: ReadonlyArray<SceneObject>, settings: Partial<Layer> = {}): Scene {
  return {
    objects,
    layers: [
      {
        ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
        hatchSpacingMm: 1,
        fillBidirectional: true,
        ...settings,
      },
    ],
  };
}

function fillXs(job: ReturnType<typeof compileJob>): number[] {
  return job.groups.flatMap((group) =>
    group.kind === 'fill'
      ? group.segments.flatMap((segment) => segment.polyline.map((p) => p.x))
      : [],
  );
}

function expectFreshEmission(
  scene: Scene,
  job: ReturnType<typeof compileJob>,
  device = DEFAULT_DEVICE_PROFILE,
) {
  const fresh = compileJob({ ...scene, objects: [...scene.objects] }, device);
  expect(grblStrategy.emit(job, device)).toBe(grblStrategy.emit(fresh, device));
}

describe('uniform Fill source selection cache', () => {
  beforeEach(() => {
    vi.mocked(fillHatchingWithMetadata).mockClear();
  });

  it('reuses partial Fill beside effective Line and Image overrides without including their material', () => {
    const scene = cacheScene([
      boundTrace('fill'),
      { ...boundTrace('line', 30), operationOverride: { mode: 'line' } },
      { ...boundTrace('image', 60), operationOverride: { mode: 'image' } },
    ]);
    const first = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    const second = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(1);
    expect(Math.min(...fillXs(second))).toBe(0);
    expect(Math.max(...fillXs(second))).toBe(10);
    expect(second.groups.some((group) => group.kind === 'cut')).toBe(true);
    expect(grblStrategy.emit(second, DEFAULT_DEVICE_PROFILE)).toBe(
      grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
    );
    expectFreshEmission(scene, second);
  });

  it('retains separate operation subsets across repeated whole-scene estimates', () => {
    const base = cacheScene([boundTrace('a', 0, ['a']), boundTrace('b', 30, ['b'])]);
    const settings = base.layers[0]!;
    const scene = {
      ...base,
      layers: [
        { ...settings, id: 'a' },
        { ...settings, id: 'b' },
      ],
    };
    const first = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    const second = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
    expect(Math.max(...fillXs(second))).toBe(40);
    expect(grblStrategy.emit(second, DEFAULT_DEVICE_PROFILE)).toBe(
      grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
    );
    expectFreshEmission(scene, second);
  });

  it('distinguishes virtual binding membership while reusing a restored selection', () => {
    const objects = [boundTrace('a', 0, ['a']), boundTrace('b', 30, ['b'])];
    const a = cacheScene(objects, { id: 'view', bindingOperationId: 'a' });
    const b = cacheScene(objects, { id: 'view', bindingOperationId: 'b' });
    const first = compileJob(a, DEFAULT_DEVICE_PROFILE);
    const other = compileJob(b, DEFAULT_DEVICE_PROFILE);
    const restored = compileJob(a, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
    expect(Math.max(...fillXs(first))).toBe(10);
    expect(Math.min(...fillXs(other))).toBe(30);
    expect(grblStrategy.emit(restored, DEFAULT_DEVICE_PROFILE)).toBe(
      grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
    );
    expectFreshEmission(b, other);
  });

  it('changes the subset with effective base mode while always excluding an Image override', () => {
    const objects = [
      { ...boundTrace('always-fill'), operationOverride: { mode: 'fill' as const } },
      boundTrace('follows-base', 30),
      { ...boundTrace('never-fill', 60), operationOverride: { mode: 'image' as const } },
    ];
    const line = cacheScene(objects, { mode: 'line' });
    const fill = cacheScene(objects);
    const first = compileJob(line, DEFAULT_DEVICE_PROFILE);
    const pooled = compileJob(fill, DEFAULT_DEVICE_PROFILE);
    const restored = compileJob(line, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
    expect(Math.max(...fillXs(first))).toBe(10);
    expect(Math.max(...fillXs(pooled))).toBe(40);
    expect(grblStrategy.emit(restored, DEFAULT_DEVICE_PROFILE)).toBe(
      grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
    );
    expectFreshEmission(fill, pooled);
  });

  it.each(['placement', 'geometry', 'binding'] as const)(
    'invalidates partial selections after an immutable %s edit',
    (edit) => {
      const original = boundTrace('a');
      const remote = boundTrace('b', 30, ['other']);
      const before = cacheScene([original, remote]);
      const changed =
        edit === 'placement'
          ? { ...original, transform: { ...original.transform, x: 5 } }
          : edit === 'geometry'
            ? {
                ...original,
                paths: original.paths.map((path) => ({
                  ...path,
                  polylines: path.polylines.map((polyline) => ({
                    ...polyline,
                    points: polyline.points.map((point) => ({ ...point, x: point.x * 2 })),
                  })),
                })),
              }
            : { ...original, operationIds: ['other'] };
      const after = cacheScene([
        changed,
        edit === 'binding' ? { ...remote, operationIds: ['fill'] } : remote,
      ]);
      const first = compileJob(before, DEFAULT_DEVICE_PROFILE);
      const updated = compileJob(after, DEFAULT_DEVICE_PROFILE);
      compileJob(after, DEFAULT_DEVICE_PROFILE);
      expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
      expect(Math.max(...fillXs(updated))).toBe(
        edit === 'placement' ? 15 : edit === 'geometry' ? 20 : 40,
      );
      expect(grblStrategy.emit(updated, DEFAULT_DEVICE_PROFILE)).not.toBe(
        grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
      );
      expectFreshEmission(after, updated);
    },
  );

  it('invalidates source-array order without reordering the selected source contours', () => {
    const a = boundTrace('a'),
      b = boundTrace('b', 30),
      remote = boundTrace('remote', 60, ['other']);
    const first = cacheScene([a, remote, b]);
    const reversed = cacheScene([b, remote, a]);
    compileJob(first, DEFAULT_DEVICE_PROFILE);
    const second = compileJob(reversed, DEFAULT_DEVICE_PROFILE);
    compileJob(reversed, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(fillHatchingWithMetadata).mock.calls;
    expect(calls[0]?.[0].polylines[0]?.points[0]?.x).toBe(0);
    expect(calls[1]?.[0].polylines[0]?.points[0]?.x).toBe(30);
    expectFreshEmission(reversed, second);
  });

  it.each(['angle', 'spacing', 'origin', 'bed'] as const)(
    'retains geometry-setting invalidation for %s changes',
    (change) => {
      const objects = [boundTrace('a'), boundTrace('other', 30, ['other'])];
      const scene = cacheScene(objects);
      compileJob(scene, DEFAULT_DEVICE_PROFILE);
      const updated = cacheScene(
        objects,
        change === 'angle'
          ? { hatchAngleDeg: 31 }
          : change === 'spacing'
            ? { hatchSpacingMm: 0.5 }
            : {},
      );
      const device =
        change === 'origin'
          ? { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const }
          : change === 'bed'
            ? { ...DEFAULT_DEVICE_PROFILE, bedHeight: DEFAULT_DEVICE_PROFILE.bedHeight + 20 }
            : DEFAULT_DEVICE_PROFILE;
      const job = compileJob(updated, device);
      compileJob(updated, device);
      expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
      expectFreshEmission(updated, job, device);
    },
  );

  it('reuses geometry for process-only edits while emitting current power, speed and passes', () => {
    const scene = cacheScene([boundTrace('a'), boundTrace('other', 30, ['other'])]);
    const first = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    const edited = {
      ...scene,
      layers: scene.layers.map((layer) => ({ ...layer, power: 20, speed: 600, passes: 3 })),
    };
    const job = compileJob(edited, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(1);
    expect(job.groups[0]).toMatchObject({ kind: 'fill', power: 20, speed: 600, passes: 3 });
    expect(grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).not.toBe(
      grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
    );
    expectFreshEmission(edited, job);
  });

  it('caps proper selections at eight memberships and evicts the oldest without changing output', () => {
    const objects = Array.from({ length: 9 }, (_, index) =>
      boundTrace('object-' + index, index * 20, ['operation-' + index]),
    );
    const scenes = objects.map((_, index) => cacheScene(objects, { id: 'operation-' + index }));
    const first = compileJob(scenes[0]!, DEFAULT_DEVICE_PROFILE);
    for (const scene of scenes.slice(1)) compileJob(scene, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(9);
    compileJob(scenes[8]!, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(9);
    const evicted = compileJob(scenes[0]!, DEFAULT_DEVICE_PROFILE);
    compileJob(scenes[0]!, DEFAULT_DEVICE_PROFILE);
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(10);
    expect(grblStrategy.emit(evicted, DEFAULT_DEVICE_PROFILE)).toBe(
      grblStrategy.emit(first, DEFAULT_DEVICE_PROFILE),
    );
    expectFreshEmission(scenes[0]!, evicted);
  });
});
