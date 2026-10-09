import * as three from 'three';
import { describe, expect, it } from 'vitest';
import { writeDepthPlane } from './line-depth-plane-geometry';

type Segment = readonly [number, number, number, number, number, number];

function stored(segment: Segment): Segment {
  return [...new Float32Array(segment)] as [number, number, number, number, number, number];
}

function plane(segment: Segment): Float32Array {
  const [x0, y0, z0, x1, y1, z1] = stored(segment);
  const result = new Float32Array(4);
  writeDepthPlane(result, 0, x0, y0, z0, x1, y1, z1);
  return result;
}

function planeWithOffset(segment: Segment) {
  const actual = stored(segment);
  const normal = new Float32Array(4);
  const residual = new Float32Array(1);
  writeDepthPlane(normal, 0, ...actual, residual);
  return { normal, residual };
}

function reverse(segment: Segment): Segment {
  return [segment[3], segment[4], segment[5], segment[0], segment[1], segment[2]];
}

function expectPackedAnchor(segment: Segment) {
  const actual = stored(segment);
  const result = planeWithOffset(actual);
  const { normal, residual } = result;
  const points = [
    new three.Vector3(actual[0], actual[1], actual[2]),
    new three.Vector3(actual[3], actual[4], actual[5]),
  ];
  const anchor = [...points].sort(
    (left, right) => left.x - right.x || left.y - right.y || left.z - right.z,
  )[0]!;
  const expectedC = -anchor.z - normal[0]! * anchor.x - normal[1]! * anchor.y;
  const high = Math.fround(expectedC);
  const low = Math.fround(expectedC - high);
  expect(normal[3]).toBe(high === 0 ? 0 : high);
  expect(residual[0]).toBe(low === 0 ? 0 : low);
  // The endpoint height error is bounded by the LOCAL Z span, never by huge c or x.
  const localBudget = Math.abs(actual[5] - actual[2]) * 2 ** -23;
  for (const point of points) {
    const error =
      normal[0]! * point.x +
      normal[1]! * point.y +
      normal[2]! * point.z +
      normal[3]! +
      residual[0]!;
    expect(Math.abs(error)).toBeLessThanOrEqual(localBudget);
  }
  return result;
}

function member(actual: Float32Array, point: three.Vector3): void {
  const terms = [actual[0]! * point.x, actual[1]! * point.y, point.z, actual[3]!];
  const residual = terms.reduce((sum, value) => sum + value, 0);
  // Test-only rounding budget for four packed Float32 coefficients, not a plane snap.
  const budget = 4 * 2 ** -24 * terms.reduce((sum, value) => sum + Math.abs(value), 0);
  expect(Math.abs(residual)).toBeLessThanOrEqual(budget + Number.EPSILON);
}

describe('canonical physical segment planes', () => {
  it.each([
    { segment: [4, 9, 2, 20, -3, 2], expected: [0, 0, 1, -2] },
    { segment: [5, 7, -4, 5, 7, -4], expected: [0, 0, 1, 4] },
    { segment: [0, 0, 0, 0, 0, -0], expected: [0, 0, 1, 0] },
  ] satisfies { segment: Segment; expected: number[] }[])(
    'uses the exact horizontal plane for $segment',
    ({ segment, expected }) => {
      expect([...plane(segment as Segment)]).toEqual(expected);
    },
  );

  it('does not treat a representable Z difference as horizontal', () => {
    const result = plane([0, 0, 1, 1, 0, 1 + 2 ** -23]);
    expect([...result]).toEqual([-(2 ** -23), 0, 1, -1]);
  });

  it.each([
    [5, 7, -4, 5, 7, 8],
    [-10, -10, 0, -10, -10, 0.001],
  ] as Segment[])('keeps a varying-Z vertical segment on raster fallback: %j', (...segment) => {
    expect([...plane(segment as Segment)]).toEqual([0, 0, 0, 0]);
  });

  it.each([
    [0, 0, 0, 100, 0, 1],
    [0, 0, 0, 0, 100, -1],
    [3, 7, 2, 6, 11, 7],
    [-40, 30, 7, 60, 30, -3],
    [10, -12, -4, -5, 7, 2],
    [3, 9, 1, 3, -4, 2],
    [1, 2, 5, 1, 2, -5],
    [0, 0, 0, -0, 0, -0],
  ] as Segment[])('has byte-identical reversal for actual endpoints: %j', (...input) => {
    const segment = input as Segment;
    expect(new Uint8Array(plane(segment).buffer)).toEqual(
      new Uint8Array(plane(reverse(segment)).buffer),
    );
  });

  it('shares the exact shortened native tie descriptor with its full retrace', () => {
    const short = plane([0, 0, 0, 50, 0, 0.5]);
    const retrace = plane([100, 0, 1, 0, 0, 0]);
    expect(short).toEqual(retrace);
    expect([...short]).toEqual([Math.fround(-0.01), 0, 1, 0]);
    expect(planeWithOffset([0, 0, 0, 50, 0, 0.5])).toEqual(planeWithOffset([100, 0, 1, 0, 0, 0]));
  });

  it('keeps the full-source prefix tie and independently anchors the shortened cap', () => {
    const done = plane([0, 0, 0, 100, 0, -10]);
    const active = plane([100, 0, -10, 50, 0, -5]);
    // Production prefixes retain the original full source pair, independent of their drawn endpoint.
    const prefix = planeWithOffset([100, 0, -10, 0, 0, 0]);
    expect(prefix).toEqual(planeWithOffset([0, 0, 0, 100, 0, -10]));
    expect(done).not.toEqual(active);
    expect([...done]).toEqual([Math.fround(0.1), 0, 1, 0]);
    expect([...active]).toEqual([Math.fround(0.1), 0, 1, -(5 * 2 ** -26)]);
    expectPackedAnchor([0, 0, 0, 100, 0, -10]);
    expectPackedAnchor([100, 0, -10, 50, 0, -5]);
  });

  it('keeps translated inputs and anchors their packed normals without choosing an axis', () => {
    expect(plane([40, -20, 7, 140, -20, -3])).toEqual(plane([140, -20, -3, 90, -20, 2]));
    expect(plane([2, 3, 4, 10, 9, 6])).toEqual(plane([10, 9, 6, 6, 6, 5]));
    const full = expectPackedAnchor([40, -20, 7, 140, -20, -3]);
    const short = expectPackedAnchor([140, -20, -3, 90, -20, 2]);
    expect(full.residual).not.toEqual(short.residual);
    const diagonal = expectPackedAnchor([2, 3, 4, 10, 9, 6]);
    const diagonalShort = expectPackedAnchor([10, 9, 6, 6, 6, 5]);
    expect(diagonal.residual).not.toEqual(diagonalShort.residual);
  });

  it.each([
    [3, 7, 2, 6, 11, 7],
    [1, -2, 3, 7, 6, 8],
    [-40, 30, 7, 60, 30, -3],
    [5, -2, 3, 5, 8, -2],
    [-2, -4, -6, 8, -4, -6],
  ] as Segment[])('contains the segment and horizontal lateral tangent: %j', (...input) => {
    const segment = stored(input as Segment);
    const start = new three.Vector3(segment[0], segment[1], segment[2]);
    const end = new three.Vector3(segment[3], segment[4], segment[5]);
    const direction = end.clone().sub(start);
    const lateral = new three.Vector3(-direction.y, direction.x, 0);
    const oracle = new three.Plane().setFromCoplanarPoints(start, end, start.clone().add(lateral));
    const actual = plane(segment);
    expect(actual[2]).toBe(1);
    const expected = [oracle.normal.x, oracle.normal.y, oracle.normal.z, oracle.constant].map(
      (value) => value / oracle.normal.z,
    );
    for (let channel = 0; channel < 4; channel++)
      expect(actual[channel]).toBeCloseTo(expected[channel]!, 6);
    for (const point of [start, end, start.clone().lerp(end, 0.375), start.clone().add(lateral)])
      member(actual, point);
  });

  it('uses the minimum XY gradient rather than a dominant-axis ramp plane', () => {
    const actual = plane([0, 0, 0, 3, 4, 5]);
    const gradient = new three.Vector2(-actual[0]!, -actual[1]!);
    expect(gradient.dot(new three.Vector2(-4, 3))).toBeCloseTo(0, 6);
    expect(gradient.dot(new three.Vector2(3, 4))).toBeCloseTo(5, 6);
    for (const amount of [-2, -1, 1, 2]) {
      const otherValidGradient = new three.Vector2(0.6, 0.8).addScaledVector(
        new three.Vector2(-4, 3),
        amount,
      );
      expect(gradient.lengthSq()).toBeLessThan(otherValidGradient.lengthSq());
    }
  });

  it('varies continuously across equal XY components', () => {
    const before = plane([0, 0, 0, 1, 1 - 2 ** -20, 1]);
    const after = plane([0, 0, 0, 1, 1 + 2 ** -20, 1]);
    expect(Math.hypot(before[0]! - after[0]!, before[1]! - after[1]!)).toBeLessThan(0.00001);
    expect(before[0]).toBeCloseTo(-0.5, 5);
    expect(before[1]).toBeCloseTo(-0.5, 5);
    expect(after[0]).toBeCloseTo(-0.5, 5);
    expect(after[1]).toBeCloseTo(-0.5, 5);
  });

  it('does not pretend a rounded partial point always has its full-source plane', () => {
    const source: Segment = [0, 0, 0, 100, 0, 1];
    const partial = stored([0.1, 0, 0.001, 100, 0, 1]);
    // The uploaded partial endpoint is no longer exactly collinear after Float32 rounding.
    const cross = new three.Vector3(partial[0], partial[1], partial[2]).cross(
      new three.Vector3(100, 0, 1),
    );
    expect(cross.lengthSq()).toBeGreaterThan(0);
    const current = plane(partial);
    expect(current).not.toEqual(plane(source));
    expect(current[3]).not.toBe(0);
    member(current, new three.Vector3(partial[0], partial[1], partial[2]));
    member(current, new three.Vector3(100, 0, 1));
  });

  it('writes just one vec4 at the supplied Float32 offset', () => {
    const target = new Float32Array(12).fill(19);
    writeDepthPlane(target, 4, 0, 0, 0, 100, 0, -10);
    expect([...target]).toEqual([19, 19, 19, 19, Math.fround(0.1), 0, 1, 0, 19, 19, 19, 19]);
  });

  it('rejects a packed normal overflow from finite Float32 endpoints and a tiny XY span', () => {
    const tiny = 2 ** -149;
    const largest = Math.fround(3.4028234663852886e38);
    const input: Segment = [0, 0, 0, tiny, 0, largest];
    expect(stored(input).every(Number.isFinite)).toBe(true);
    expect(tiny).toBeGreaterThan(0);
    expect([...plane(input)]).toEqual([0, 0, 0, 0]);
    expect(plane(reverse(input))).toEqual(plane(input));
  });

  it('retains a finite plane for the smallest Float32 XY span without a tolerance', () => {
    const tiny = 2 ** -149;
    expect([...plane([0, 0, 0, tiny, 0, tiny])]).toEqual([-1, 0, 1, 0]);
  });

  it('clears all coefficients when only the packed offset overflows', () => {
    const largest = Math.fround(3.4028234663852886e38);
    const anchor = Math.fround(largest * 0.75);
    const input: Segment = [anchor, anchor, 0, largest, largest, largest];
    expect(stored(input).every(Number.isFinite)).toBe(true);
    const target = new Float32Array(8).fill(19);
    writeDepthPlane(target, 4, ...input);
    expect([...target]).toEqual([19, 19, 19, 19, 0, 0, 0, 0]);
  });

  it('preserves large-origin exact-normal membership using two actual Float32 offsets', () => {
    const segment = stored([1e8, 0, 0.25, 1e8 + 8, 0, 1.25]);
    const { normal, residual } = planeWithOffset(segment);
    expect([...normal]).toEqual([-0.125, 0, 1, 12_500_000]);
    expect([...residual]).toEqual([-0.25]);
    const points = [
      new three.Vector3(segment[0], segment[1], segment[2]),
      new three.Vector3(segment[3], segment[4], segment[5]),
      new three.Vector3(segment[0], 20, segment[2]),
    ];
    for (const point of points) {
      const highOnly =
        normal[0]! * point.x + normal[1]! * point.y + normal[2]! * point.z + normal[3]!;
      expect(highOnly).toBe(0.25);
      expect(highOnly + residual[0]!).toBe(0);
    }
    const reversed = planeWithOffset(reverse(segment));
    expect(new Uint8Array(reversed.normal.buffer)).toEqual(new Uint8Array(normal.buffer));
    expect(new Uint8Array(reversed.residual.buffer)).toEqual(new Uint8Array(residual.buffer));
  });

  it.each([
    [1e8, 0, 0, 1e8 + 24, 0, Math.fround(0.1)],
    [10_000_000, 0, 0, 10_000_100, 0, 30],
  ] as Segment[])(
    'anchors a nonrepresentable large-origin normal within local-span error: %j',
    (...input) => {
      const segment = stored(input as Segment);
      const result = expectPackedAnchor(segment);
      const oracleSlope = (segment[5] - segment[2]) / (segment[3] - segment[0]);
      expect(result.normal[0]).toBe(Math.fround(-oracleSlope));
      expect(result.normal[1]).toBe(0);
      const oldC = oracleSlope * segment[0];
      const oldStartError = result.normal[0]! * segment[0] + oldC;
      expect(Math.abs(oldStartError)).toBeGreaterThan(0.01);
      const reversed = planeWithOffset(reverse(segment));
      expect(new Uint8Array(reversed.normal.buffer)).toEqual(new Uint8Array(result.normal.buffer));
      expect(new Uint8Array(reversed.residual.buffer)).toEqual(
        new Uint8Array(result.residual.buffer),
      );
    },
  );

  it('writes the residual only at its supplied scalar offset', () => {
    const normal = new Float32Array(12).fill(19);
    const residual = new Float32Array(4).fill(23);
    writeDepthPlane(normal, 4, 1e8, 0, 0.25, 1e8 + 8, 0, 1.25, residual, 2);
    expect([...normal]).toEqual([19, 19, 19, 19, -0.125, 0, 1, 12_500_000, 19, 19, 19, 19]);
    expect([...residual]).toEqual([23, 23, -0.25, 23]);
  });

  it.each([
    { name: 'horizontal', input: [0, 0, 2, 10, 5, 2], expected: [0, 0, 1, -2] },
    { name: 'vertical', input: [5, 7, -4, 5, 7, 8], expected: [0, 0, 0, 0] },
    {
      name: 'normal overflow',
      input: [0, 0, 0, 2 ** -149, 0, Math.fround(3.4028234663852886e38)],
      expected: [0, 0, 0, 0],
    },
    {
      name: 'offset overflow',
      input: [
        Math.fround(3.4028234663852886e38 * 0.75),
        Math.fround(3.4028234663852886e38 * 0.75),
        0,
        Math.fround(3.4028234663852886e38),
        Math.fround(3.4028234663852886e38),
        Math.fround(3.4028234663852886e38),
      ],
      expected: [0, 0, 0, 0],
    },
  ] satisfies { name: string; input: Segment; expected: number[] }[])(
    'clears a stale residual on $name output',
    ({ input, expected }) => {
      const normal = new Float32Array(4).fill(19);
      const residual = new Float32Array([23]);
      writeDepthPlane(normal, 0, ...stored(input as Segment), residual);
      expect([...normal]).toEqual(expected);
      expect([...residual]).toEqual([0]);
    },
  );
});
