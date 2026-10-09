import * as three from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it } from 'vitest';
import {
  addDepthPlanes,
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
  writeDepthPlane,
} from './line-depth-plane-geometry';

type Segment = readonly [number, number, number, number, number, number];
type Point = readonly [number, number, number];
const ATTRIBUTES = [
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
];

function stored(segment: Segment): Segment {
  return [...new Float32Array(segment)] as [number, number, number, number, number, number];
}

function descriptor(input: Segment) {
  const segment = stored(input);
  const normal = new Float32Array(4),
    low = new Float32Array(1),
    origin = new Float32Array(4);
  writeDepthPlane(normal, 0, ...segment, low, 0, origin);
  return { segment, normal, low, origin };
}

function reverse(segment: Segment): Segment {
  return [segment[3], segment[4], segment[5], segment[0], segment[1], segment[2]];
}

function geometryFor(kind: 'fat' | 'native', segments: readonly Segment[]): three.BufferGeometry {
  const positions = new Float32Array(segments.flat());
  if (kind === 'fat') return new LineSegmentsGeometry().setPositions(positions);
  return new three.BufferGeometry().setAttribute(
    'position',
    new three.BufferAttribute(positions, 3),
  );
}

function localMembership(actual: ReturnType<typeof descriptor>, point: Point): number {
  return (
    actual.normal[0]! * (point[0] - actual.origin[0]!) +
    actual.normal[1]! * (point[1] - actual.origin[1]!) +
    (point[2] - actual.origin[2]!) +
    actual.origin[3]! +
    actual.low[0]!
  );
}

describe('canonical stored source origins', () => {
  it.each([
    { input: [4, 9, 2, 20, -3, 2], xyz: [4, 9, 2] },
    { input: [10, 9, 2, 10, -3, 2], xyz: [10, -3, 2] },
    { input: [5, 7, -4, 5, 7, -4], xyz: [5, 7, -4] },
    { input: [5, 7, -4, 5, 7, 8], xyz: [5, 7, -4] },
    { input: [0, -0, 0, -0, 0, -0], xyz: [0, 0, 0] },
    { input: [3, 7, 2, 6, 11, 7], xyz: [3, 7, 2] },
    { input: [10000100, 0, 30, 10000000, 0, 0], xyz: [10000000, 0, 0] },
    { input: [1e8, 0, 0.25, 1e8 + 8, 0, 1.25], xyz: [1e8, 0, 0.25] },
    { input: [0, 0, 0, 2 ** -149, 0, 2 ** -149], xyz: [0, 0, 0] },
  ] satisfies { input: Segment; xyz: Point }[])(
    'keeps canonical origin and reversal bytes for $input',
    ({ input, xyz }) => {
      const actual = descriptor(input),
        reversed = descriptor(reverse(input));
      expect([...actual.origin.slice(0, 3)]).toEqual(xyz);
      for (const name of ['normal', 'low', 'origin'] as const)
        expect(new Uint8Array(actual[name].buffer)).toEqual(new Uint8Array(reversed[name].buffer));
      const legacyNormal = new Float32Array(4),
        legacyLow = new Float32Array(1);
      writeDepthPlane(legacyNormal, 0, ...actual.segment, legacyLow);
      expect(new Uint8Array(actual.normal.buffer)).toEqual(new Uint8Array(legacyNormal.buffer));
      expect(new Uint8Array(actual.low.buffer)).toEqual(new Uint8Array(legacyLow.buffer));
    },
  );

  it.each([
    [10000000, 0, 0, 10000100, 0, 30],
    [10000000, 10000000, 0, 10000100, 10000200, 30],
    [1e8, 0, 0.25, 1e8 + 8, 0, 1.25],
    [40, -20, 7, 140, -20, -3],
  ] as Segment[])('contains the large-anchor segment in local coordinates: %j', (...input) => {
    const actual = descriptor(input as Segment);
    const s = actual.segment;
    const midpoint: Point = [(s[0] + s[3]) / 2, (s[1] + s[4]) / 2, (s[2] + s[5]) / 2];
    const lateral: Point = [s[0] - (s[4] - s[1]), s[1] + (s[3] - s[0]), s[2]];
    const budget = Math.abs(s[5] - s[2]) * 2 ** -23;
    for (const point of [[s[0], s[1], s[2]], [s[3], s[4], s[5]], midpoint, lateral] as Point[])
      expect(Math.abs(localMembership(actual, point))).toBeLessThanOrEqual(budget);
    const highOnlyLocal =
      actual.normal[3]! +
      actual.normal[0]! * actual.origin[0]! +
      actual.normal[1]! * actual.origin[1]! +
      actual.origin[2]!;
    expect(actual.origin[3]).toBe(
      Math.fround(highOnlyLocal) === 0 ? 0 : Math.fround(highOnlyLocal),
    );
  });

  it('separates a small local constant from the unchanged large world high and low', () => {
    const actual = descriptor([1e8, 0, 0.25, 1e8 + 8, 0, 1.25]);
    expect([...actual.normal]).toEqual([-0.125, 0, 1, 12_500_000]);
    expect([...actual.low]).toEqual([-0.25]);
    expect([...actual.origin]).toEqual([1e8, 0, 0.25, 0.25]);
    expect(actual.origin[3]! + actual.low[0]!).toBe(0);
    expect(localMembership(actual, [1e8 + 8, 20, 1.25])).toBe(0);
  });

  it('writes only the requested origin row and retains the old independent offsets', () => {
    const normal = new Float32Array(12).fill(19);
    const low = new Float32Array(4).fill(23);
    const origin = new Float32Array(12).fill(29);
    writeDepthPlane(normal, 4, 1e8, 0, 0.25, 1e8 + 8, 0, 1.25, low, 2, origin, 4);
    expect([...normal]).toEqual([19, 19, 19, 19, -0.125, 0, 1, 12_500_000, 19, 19, 19, 19]);
    expect([...low]).toEqual([23, 23, -0.25, 23]);
    expect([...origin]).toEqual([29, 29, 29, 29, 1e8, 0, 0.25, 0.25, 29, 29, 29, 29]);
  });

  it.each([
    [0, 0, 0, 2 ** -149, 0, Math.fround(3.4028234663852886e38)],
    [NaN, 0, 2, 10, 0, 2],
    [0, 0, 2, Infinity, 0, 2],
    [0, 0, Infinity, 10, 0, Infinity],
  ] as Segment[])('clears all stale companions for unusable source: %j', (...input) => {
    const normal = new Float32Array(4).fill(19),
      low = new Float32Array([23]);
    const origin = new Float32Array(4).fill(29);
    writeDepthPlane(normal, 0, ...stored(input as Segment), low, 0, origin);
    expect([...normal]).toEqual([0, 0, 0, 0]);
    expect([...low]).toEqual([0]);
    expect([...origin]).toEqual([0, 0, 0, 0]);
  });

  it('clears origin when only the packed high offset overflows', () => {
    const largest = Math.fround(3.4028234663852886e38),
      anchor = Math.fround(largest * 0.75);
    const actual = descriptor([anchor, anchor, 0, largest, largest, largest]);
    expect([...actual.normal]).toEqual([0, 0, 0, 0]);
    expect([...actual.low]).toEqual([0]);
    expect([...actual.origin]).toEqual([0, 0, 0, 0]);
  });
});

describe('source-origin geometry companions', () => {
  it.each(['fat', 'native'] as const)(
    'marks only valid varying-Z %s sources for the shared vertical plane',
    (kind) => {
      const source: Segment = [5, 7, -4, 5, 7, 8];
      const geometry = geometryFor(kind, [source, reverse(source)]);
      addDepthPlanes(three, geometry, kind);
      expect([...geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array]).toEqual(
        new Array(kind === 'fat' ? 8 : 16).fill(0),
      );
      expect([...geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array]).toEqual(
        new Array(kind === 'fat' ? 2 : 4).fill(0),
      );
      const origin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
      const expected = [5, 7, -4, 1];
      for (let row = 0; row < origin.count; row++)
        expect([...origin.array.slice(row * 4, row * 4 + 4)]).toEqual(expected);
      const prefix = descriptor([5, 7, -4, 5, 7, 2]);
      expect([...prefix.normal]).toEqual([0, 0, 0, 0]);
      expect([...prefix.origin]).toEqual(expected);
      geometry.dispose();
    },
  );

  const source: Segment = [10000000, 0, 0, 10000100, 0, 30];

  it.each(['fat', 'native'] as const)(
    'adds the actual large-anchor %s origin without a position copy',
    (kind) => {
      const geometry = geometryFor(kind, [source, reverse(source)]);
      if (kind === 'fat')
        (geometry as LineSegmentsGeometry).setColors(new Float32Array(12).fill(0.5));
      const position = geometry.getAttribute(kind === 'fat' ? 'instanceStart' : 'position');
      const originalArray = position.array as Float32Array;
      const originalWords = [
        ...new Uint32Array(originalArray.buffer, originalArray.byteOffset, originalArray.length),
      ];
      const colour = geometry.getAttribute('instanceColorStart');
      addDepthPlanes(three, geometry, kind);
      const origin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
      const repeat = kind === 'fat' ? 2 : 4;
      expect(origin.array).toBeInstanceOf(Float32Array);
      expect(origin.itemSize).toBe(4);
      expect(origin.count).toBe(repeat);
      expect(origin.normalized).toBe(false);
      expect(origin).toBeInstanceOf(
        kind === 'fat' ? three.InstancedBufferAttribute : three.BufferAttribute,
      );
      if (kind === 'native') expect(origin).not.toBeInstanceOf(three.InstancedBufferAttribute);
      else expect((origin as three.InstancedBufferAttribute).meshPerAttribute).toBe(1);
      const actual = descriptor(source);
      for (let row = 0; row < repeat; row++)
        expect(new Uint8Array(origin.array.buffer, row * 16, 16)).toEqual(
          new Uint8Array(actual.origin.buffer),
        );
      const payload = ATTRIBUTES.reduce(
        (bytes, name) => bytes + geometry.getAttribute(name).array.byteLength,
        0,
      );
      expect(payload).toBe(2 * (kind === 'fat' ? 36 : 72));
      expect(position.array).toBe(originalArray);
      expect([
        ...new Uint32Array(originalArray.buffer, originalArray.byteOffset, originalArray.length),
      ]).toEqual(originalWords);
      expect(geometry.getAttribute('instanceColorStart')).toBe(colour);
      geometry.dispose();
    },
  );

  it.each(['fat', 'native'] as const)(
    'reads the stored rounded endpoints for %s origins',
    (kind) => {
      const geometry = geometryFor(kind, [[4, 9, 1 + 2 ** -25, 20, -3, 1 + 2 ** -24]]);
      addDepthPlanes(three, geometry, kind);
      const origin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
      expect([...origin.array]).toEqual(kind === 'fat' ? [4, 9, 1, 0] : [4, 9, 1, 0, 4, 9, 1, 0]);
      geometry.dispose();
    },
  );

  it.each(['fat', 'native'] as const)(
    'reuses all three %s attributes on a shared geometry without source data',
    (kind) => {
      const geometry = geometryFor(kind, [source]);
      const plane = addDepthPlanes(three, geometry, kind);
      const shared = new three.BufferGeometry();
      for (const name of ATTRIBUTES) shared.setAttribute(name, geometry.getAttribute(name));
      expect(addDepthPlanes(three, shared, kind)).toBe(plane);
      for (const name of ATTRIBUTES) {
        expect(shared.getAttribute(name)).toBe(geometry.getAttribute(name));
        expect(shared.getAttribute(name).array).toBe(geometry.getAttribute(name).array);
      }
      geometry.dispose();
      shared.dispose();
    },
  );

  it.each(['fat', 'native'] as const)(
    'repairs a missing origin while retaining %s source and descriptor aliases',
    (kind) => {
      const geometry = geometryFor(kind, [source]);
      const plane = addDepthPlanes(three, geometry, kind);
      const shared = new three.BufferGeometry();
      const names = kind === 'fat' ? ['instanceStart', 'instanceEnd'] : ['position'];
      for (const name of [...names, DEPTH_PLANE_ATTRIBUTE, DEPTH_PLANE_OFFSET_ATTRIBUTE])
        shared.setAttribute(name, geometry.getAttribute(name));
      expect(addDepthPlanes(three, shared, kind)).toBe(plane);
      for (const name of [...names, DEPTH_PLANE_ATTRIBUTE, DEPTH_PLANE_OFFSET_ATTRIBUTE])
        expect(shared.getAttribute(name)).toBe(geometry.getAttribute(name));
      expect(shared.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE).array).toEqual(
        geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE).array,
      );
      expect(shared.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE).array).not.toBe(
        geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE).array,
      );
      geometry.dispose();
      shared.dispose();
    },
  );

  it.each(ATTRIBUTES)('repairs missing %s without replacing its two companions', (missing) => {
    const geometry = geometryFor('native', [source, reverse(source)]);
    addDepthPlanes(three, geometry, 'native');
    const old = new Map(ATTRIBUTES.map((name) => [name, geometry.getAttribute(name)]));
    const words = new Map(
      ATTRIBUTES.map((name) => [
        name,
        [...new Uint32Array(geometry.getAttribute(name).array.buffer)],
      ]),
    );
    geometry.deleteAttribute(missing);
    addDepthPlanes(three, geometry, 'native');
    for (const name of ATTRIBUTES) {
      if (name !== missing) expect(geometry.getAttribute(name)).toBe(old.get(name));
      else expect(geometry.getAttribute(name)).not.toBe(old.get(name));
      expect([...new Uint32Array(geometry.getAttribute(name).array.buffer)]).toEqual(
        words.get(name),
      );
    }
    geometry.dispose();
  });

  it('leaves the unmatched native origin at positive zero fallback', () => {
    const geometry = new three.BufferGeometry().setAttribute(
      'position',
      new three.BufferAttribute(new Float32Array([...source, 3, 4, 5]), 3),
    );
    addDepthPlanes(three, geometry, 'native');
    const origin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
    expect(origin.count).toBe(3);
    expect([...origin.array.slice(8)]).toEqual([0, 0, 0, 0]);
    expect([...new Uint32Array(origin.array.buffer).slice(8)]).toEqual([0, 0, 0, 0]);
    geometry.dispose();
  });

  it.each(['fat', 'native'] as const)(
    'retains an empty and idempotent %s origin companion',
    (kind) => {
      const geometry = geometryFor(kind, []);
      const normal = addDepthPlanes(three, geometry, kind);
      const origin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
      expect(origin.count).toBe(0);
      expect(origin.array.byteLength).toBe(0);
      expect(addDepthPlanes(three, geometry, kind)).toBe(normal);
      expect(geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE)).toBe(origin);
      geometry.dispose();
    },
  );
});
