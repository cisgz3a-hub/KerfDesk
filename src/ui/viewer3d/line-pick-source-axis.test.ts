import * as three from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it } from 'vitest';
import { shareProgramGeometry } from './program-lines';
import {
  addPickSourceAxes,
  PICK_SOURCE_AXIS_ATTRIBUTE,
  writePickSourceAxis,
} from './line-pick-source-axis';

type Point = readonly [number, number, number];

function axis(start: Point, end: Point): Float32Array {
  const stored = new Float32Array([...start, ...end]);
  const target = new Float32Array(3);
  writePickSourceAxis(
    target,
    0,
    stored[0] ?? 0,
    stored[1] ?? 0,
    stored[2] ?? 0,
    stored[3] ?? 0,
    stored[4] ?? 0,
    stored[5] ?? 0,
  );
  return target;
}

function bits(values: Float32Array): number[] {
  return [...new Uint32Array(values.buffer, values.byteOffset, values.length)];
}

describe('full stored source axes for the lazy ID pass', () => {
  it.each([
    { start: [0, 0, -25], end: [100, 0, 25], expected: [1.5625, 0, 0.78125] },
    { start: [0, 0, 0], end: [100, 0, 0], expected: [1.5625, 0, 0] },
    { start: [0, 0, 0], end: [0, 0, 100], expected: [0, 0, 1.5625] },
    { start: [20, 30, -5], end: [12, 26, 3], expected: [1, 0.5, -1] },
  ])('canonicalises $start to $end before subtraction', ({ start, end, expected }) => {
    const a = axis(start as unknown as Point, end as unknown as Point);
    const b = axis(end as unknown as Point, start as unknown as Point);
    expect([...a]).toEqual(expected);
    expect(bits(a)).toEqual(bits(b));
  });

  it('power-of-two scaling preserves a representable non-power-of-two source slope', () => {
    const endZ = Math.fround(30.0000019);
    const actual = axis([0, 0, 0], [100, 0, endZ]);
    expect([...actual]).toEqual([100 / 64, 0, endZ / 64]);
    expect((actual[2] ?? 0) * 100).toBe((actual[0] ?? 0) * endZ);
    expect(Math.fround(endZ / 100) * 100).not.toBe(endZ);
    expect((actual[2] ?? 0) * 64).toBe(endZ);
  });

  it('uses actual Float32 endpoints and survives finite endpoint-difference overflow', () => {
    expect([...axis([1e8, 0, 0.25], [1e8 + 8, 0, 1.25])]).toEqual([1, 0, 0.125]);
    expect([...axis([1e8, 0, 0], [1e8 + 1, 0, 0])]).toEqual([0, 0, 0]);
    const maximum = Math.fround(3.4028234663852886e38);
    const actual = axis([-maximum, 0, 0], [maximum, 0, 0]);
    expect([...actual].every(Number.isFinite)).toBe(true);
    expect(actual[0]).toBe(Math.fround((2 * maximum) / 2 ** 128));
    expect(actual[0]).toBeGreaterThan(1);
    expect(bits(actual)).toEqual(bits(axis([maximum, 0, 0], [-maximum, 0, 0])));
  });

  it('retains the smallest stored axis and exposes subdominant Float32 underflow', () => {
    const tiny = new Float32Array([2 ** -149])[0] ?? 0;
    expect([...axis([0, 0, 0], [tiny, 0, 0])]).toEqual([1, 0, 0]);
    const huge = Math.fround(3.4028234663852886e38);
    const underflow = axis([0, 0, 0], [huge, tiny, 0]);
    expect(underflow[0]).toBeGreaterThan(1);
    expect(underflow[1]).toBe(0); // This descriptor cannot preserve an 84-decade ratio.
    expect(bits(underflow)).toEqual(bits(axis([huge, tiny, 0], [0, 0, 0])));
  });

  it('exposes Float32 rounding of a stored endpoint difference without underflow', () => {
    const actual = axis([-1, 0, 0], [2 ** -24, 0, 1]);
    expect([...actual]).toEqual([1, 0, 1]);
    expect(actual[0]).not.toBe(1 + 2 ** -24);
    expect(bits(actual)).toEqual(bits(axis([2 ** -24, 0, 1], [-1, 0, 0])));
  });

  it('clears invalid/point inputs without signed-zero direction bits', () => {
    for (const start of [
      [NaN, 0, 0],
      [Infinity, 0, 0],
      [-Infinity, 0, 0],
    ] as Point[]) {
      const target = new Float32Array([9, 9, 9]);
      writePickSourceAxis(target, 0, ...start, 0, 0, 0);
      expect(bits(target)).toEqual([0, 0, 0]);
    }
    expect(bits(axis([-0, 0, -0], [0, -0, 0]))).toEqual([0, 0, 0]);
  });

  it('adds one immutable instanced vec3 per full fat source row without changing positions', () => {
    const positions = new Float32Array([0, 0, -25, 100, 0, 25, 100, 0, 25, 0, 0, -25]);
    const before = positions.slice();
    const full = new LineSegmentsGeometry().setPositions(positions);
    full.setAttribute(
      'instanceShown',
      new three.InstancedBufferAttribute(new Uint16Array([65535, 0]), 1, true),
    );
    full.instanceCount = 1; // Playback draws a prefix; ID geometry still reads the full source.
    const copy = shareProgramGeometry(LineSegmentsGeometry, full);
    const sourceStart = copy.getAttribute('instanceStart');
    const result = addPickSourceAxes(three, copy, 'fat');
    expect(result).toBeInstanceOf(three.InstancedBufferAttribute);
    expect(result.itemSize).toBe(3);
    expect(result.count).toBe(2);
    expect(result.array.byteLength).toBe(12 * 2);
    expect(bits(result.array as Float32Array).slice(0, 3)).toEqual(
      bits(result.array as Float32Array).slice(3),
    );
    expect(addPickSourceAxes(three, copy, 'fat')).toBe(result);
    expect(copy.getAttribute('instanceStart')).toBe(sourceStart);
    expect(copy.getAttribute('instanceStart')).toBe(full.getAttribute('instanceStart'));
    expect(full.getAttribute(PICK_SOURCE_AXIS_ATTRIBUTE)).toBeUndefined();
    expect(positions).toEqual(before);
    copy.dispose();
    full.dispose();
  });

  it('duplicates native pair bits and reuses descriptor/position buffers on repeated picks', () => {
    const positions = new Float32Array([100, 0, 25, 0, 0, -25]);
    const before = positions.slice(),
      position = new three.BufferAttribute(positions, 3);
    const geometry = new three.BufferGeometry().setAttribute('position', position);
    const result = addPickSourceAxes(three, geometry, 'native');
    expect(result).toBeInstanceOf(three.BufferAttribute);
    expect(result).not.toBeInstanceOf(three.InstancedBufferAttribute);
    expect(result.count).toBe(2);
    expect(result.array.byteLength).toBe(24);
    expect(bits(result.array as Float32Array).slice(0, 3)).toEqual(
      bits(result.array as Float32Array).slice(3),
    );
    expect(addPickSourceAxes(three, geometry, 'native')).toBe(result);
    expect(geometry.getAttribute('position')).toBe(position);
    expect(position.array).toBe(positions);
    expect(positions).toEqual(before);
    geometry.dispose();
  });
});
