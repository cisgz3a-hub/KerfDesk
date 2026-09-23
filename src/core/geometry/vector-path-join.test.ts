import { describe, expect, it } from 'vitest';
import {
  repairArtwork,
  repairLine,
  repairMetrics,
  repairRectangle,
} from '../../__fixtures__/vector-repair-fixtures';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { joinOpenVectorPaths } from './vector-path-join';

const cut = createLayer({ id: 'cut', color: '#000000' });
const line = (id: string, x1: number, x2: number) =>
  repairArtwork(id, [repairLine({ x: x1, y: 0 }, { x: x2, y: 0 })]);
function join(objects: ReadonlyArray<ImportedSvg>, tolerance = 0.05) {
  const result = joinOpenVectorPaths(objects, [cut], tolerance);
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

describe('join open artwork paths', () => {
  it('uses physical gap after scale/mirror/rotation and preserves every source segment plus the short bridge', () => {
    const a = { ...line('a', 0, 5), transform: { ...IDENTITY_TRANSFORM, x: 10, scaleX: 2 } };
    const b = {
      ...line('b', 0, 5),
      transform: { ...IDENTITY_TRANSFORM, x: 20.04, scaleX: 3, mirrorX: true, rotationDeg: 180 },
    };
    const before = structuredClone([a, b]);
    expect(join([a, b], 0.039).objects).toEqual([a, b]);
    const result = join([a, b]);
    expect(result).toMatchObject({ joins: 1, closures: 0, remainingOpenPaths: 1 });
    expect(result.objects).toHaveLength(1);
    const output = result.objects[0] as ImportedSvg;
    expect(output.transform).toEqual(IDENTITY_TRANSFORM);
    expect(output.paths[0]?.curves?.[0]?.segments.map((segment) => segment.to.x)).toEqual([
      20, 20.04, 35.04,
    ]);
    expect(repairMetrics(output).length).toBeCloseTo(25.04, 8);
    expect(output.paths[0]?.operationIds).toEqual(['cut']);
    expect([a, b]).toEqual(before);
  });

  it('keeps distinct operation roots separate even when settings are identical', () => {
    const a = line('a', 0, 10);
    const b = { ...line('b', 10, 20), operationIds: ['other'] };
    const result = joinOpenVectorPaths([a, b], [cut, { ...cut, id: 'other' }], 0.05);
    expect(result).toMatchObject({ kind: 'ok', value: { joins: 0, closures: 0, objects: [a, b] } });
  });

  it('honours path-level bindings, multiple operations and conservative artwork-setting compatibility', () => {
    const a = {
      ...line('a', 0, 10),
      operationIds: ['ignored'],
      operationOverride: { speed: 120, passes: 2 },
      paths: [{ ...line('a', 0, 10).paths[0]!, operationIds: ['cut', 'second'] }],
    };
    const b = {
      ...line('b', 10, 20),
      operationIds: ['second', 'cut'],
      powerScale: 100,
      operationOverride: { passes: 2, speed: 120 },
    };
    expect(join([a, b]).joins).toBe(1);
    expect(join([a, { ...b, operationOverride: { speed: 121, passes: 2 } }]).joins).toBe(0);
    expect(join([a, { ...b, powerScale: 50 }]).joins).toBe(0);
    expect(join([a, { ...b, operationIds: ['cut'] }]).joins).toBe(0);
    expect(
      join([a, { ...b, paths: b.paths.map((path) => ({ ...path, strokeWidthMm: 2 })) }]).joins,
    ).toBe(0);
  });

  it('promotes legacy colour ownership and joins across different coloured-path slots in the same artwork', () => {
    const a = line('a', 0, 10);
    const { operationIds: _ids, ...legacy } = line('b', 10, 20);
    expect(join([a, legacy]).joins).toBe(1);
    const compound = { ...a, paths: [...a.paths, ...legacy.paths] };
    const result = join([compound]);
    expect(result.joins).toBe(1);
    expect(result.objects[0]?.paths).toHaveLength(1);
  });

  it('joins reversed chains at the earliest source slot, without duplicate zero-length segments', () => {
    const result = join([line('middle', 20, 10), line('end', 20, 30), line('start', 0, 10)], 0);
    expect(result.joins).toBe(2);
    expect(result.objects[0]?.id).toBe('middle');
    const curve = result.objects[0]?.paths[0]?.curves?.[0];
    expect(curve?.segments).toHaveLength(3);
    expect(curve?.start.x).toBe(30);
    expect(curve?.segments.map((segment) => segment.to.x)).toEqual([20, 10, 0]);
  });

  it('closes a four-piece ring and keeps a two-point line open', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const objects = points.map((point, index) =>
      repairArtwork(String(index), [repairLine(point, points[(index + 1) % 4]!)]),
    );
    const result = join(objects, 0);
    expect(result).toMatchObject({ joins: 3, closures: 1, remainingOpenPaths: 0 });
    expect(repairMetrics(result.objects[0] as ImportedSvg)).toEqual({ area: 100, length: 40 });
    expect(result.objects[0]?.paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(join([line('tiny', 0, 0.02)], 0.05).closures).toBe(0);
  });

  it('leaves a three-way junction unchanged instead of choosing a branch from click order', () => {
    const objects = [
      line('a', 0, 10),
      line('b', 10, 20),
      repairArtwork('c', [repairLine({ x: 10, y: 0 }, { x: 10, y: 10 })]),
    ];
    const result = join(objects);
    expect(result).toMatchObject({ joins: 0, ambiguousEndpoints: 3, objects });
    expect(join([...objects].reverse()).joins).toBe(0);
    const tabbedBranch = {
      ...objects[2]!,
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.4 }],
    };
    expect(join([objects[0]!, objects[1]!, tabbedBranch])).toMatchObject({
      joins: 0,
      ambiguousEndpoints: 3,
      tabbedPaths: 1,
    });
  });

  it('preserves closed contours and remaps unaffected manual tabs when an earlier path is consumed', () => {
    const a = line('a', 0, 10);
    const b = {
      ...line('b', 10, 20),
      paths: [
        line('b', 10, 20).paths[0]!,
        { color: '#000000', polylines: [repairRectangle(50, 50, 10, 10)] },
      ],
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: 1, polylineIndex: 0, pathT: 0.3 }],
    };
    const result = join([a, b]);
    expect(result.joins).toBe(1);
    expect(result.objects[1]?.cncTabAnchors).toEqual([
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.3 },
    ]);
    expect(result.objects[1]?.paths[0]?.polylines).toEqual([repairRectangle(50, 50, 10, 10)]);
    const protectedB = {
      ...b,
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.5 }],
    };
    expect(join([a, protectedB])).toMatchObject({
      joins: 0,
      tabbedPaths: 1,
      objects: [a, protectedB],
    });
  });

  it('keeps identical-source canonical cubics instead of their deliberately stale compatibility lines', () => {
    const a = {
      ...line('a', 50, 60),
      paths: [
        {
          color: '#000000',
          polylines: [repairLine({ x: 50, y: 0 }, { x: 60, y: 0 })],
          curves: [
            {
              start: { x: 0, y: 0 },
              closed: false,
              segments: [
                {
                  kind: 'cubic' as const,
                  control1: { x: 2, y: 5 },
                  control2: { x: 8, y: 5 },
                  to: { x: 10, y: 0 },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = join([a, line('b', 10, 20)], 0);
    expect(result.joins).toBe(1);
    expect(result.objects[0]?.paths[0]?.curves?.[0]?.segments[0]).toEqual(
      a.paths[0]?.curves[0]?.segments[0],
    );
    expect(result.objects[0]?.bounds.maxY).toBeCloseTo(3.75, 10);
  });

  it('rejects invalid tolerances and singular transforms without output', () => {
    for (const tolerance of [-1, NaN, Infinity])
      expect(joinOpenVectorPaths([line('a', 0, 10)], [cut], tolerance).kind).toBe('error');
    expect(
      joinOpenVectorPaths(
        [{ ...line('a', 0, 10), transform: { ...IDENTITY_TRANSFORM, scaleX: 0 } }],
        [cut],
        1,
      ).kind,
    ).toBe('error');
  });

  it('joins a long chain without recursion or repeated growing concatenations', () => {
    const objects = Array.from({ length: 5000 }, (_, index) =>
      line(String(index), index * 10, (index + 1) * 10),
    );
    const result = join(objects, 0);
    expect(result.joins).toBe(4999);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]?.paths[0]?.curves?.[0]?.segments).toHaveLength(5000);
  });
});
