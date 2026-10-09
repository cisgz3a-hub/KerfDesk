import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it } from 'vitest';
import { createToolpathPicker } from './scene-pick';
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

  it('rounds the delta before selecting its power-of-two binade', () => {
    const belowTwo = Math.fround(2 - 2 ** -23);
    expect([...axis([0, 0, 0], [belowTwo, 0, 1])]).toEqual([belowTwo, 0, 1]);
    expect([...axis([0, 0, 0], [2, 0, 1])]).toEqual([1, 0, 0.5]);
    const endpoint = Math.fround(1 - 2 ** -24);
    const rounded = axis([-1, 0, 0], [endpoint, 0, 1]);
    expect([...rounded]).toEqual([1, 0, 0.5]);
    // Old double-delta/binade ordering selected scale 1 before packing delta to 2.
    const oldScale = 2 ** Math.floor(Math.log2(endpoint + 1));
    expect([Math.fround((endpoint + 1) / oldScale), 0, Math.fround(1 / oldScale)]).toEqual([
      2, 0, 1,
    ]);
    expect(bits(rounded)).toEqual(bits(axis([endpoint, 0, 1], [-1, 0, 0])));
  });

  it('halves only for a large opposed component before rounded subtraction', () => {
    const maximum = Math.fround(3.4028234663852886e38);
    const packedMaximum = Math.fround(maximum / 2 ** 127);
    const actual = axis([-maximum, 0, maximum], [maximum, 0, -maximum]);
    expect([...actual]).toEqual([packedMaximum, 0, -packedMaximum]);
    expect(bits(actual)).toEqual(bits(axis([maximum, 0, -maximum], [-maximum, 0, maximum])));
    // The exact guard boundary needs no halving and does not overflow subtraction.
    expect([...axis([-maximum / 2, 0, 0], [maximum / 2, 0, maximum / 2])]).toEqual([
      packedMaximum,
      0,
      Math.fround(packedMaximum / 2),
    ]);
  });

  it('keeps a tiny Y-only axis beside a huge common X coordinate', () => {
    const maximum = Math.fround(3.4028234663852886e38);
    const tiny = 2 ** -149;
    const actual = axis([maximum, -tiny, 0], [maximum, tiny, 0]);
    expect([...actual]).toEqual([0, 1, 0]);
    expect(bits(actual)).toEqual(bits(axis([maximum, tiny, 0], [maximum, -tiny, 0])));
    // A global large-coordinate guard would round both half-sized Y values to zero.
    expect(Math.fround(tiny * 0.5)).toBe(0);
  });

  it('normalises subnormal major deltas before extracting a normal exponent', () => {
    const tiny = 2 ** -149;
    expect([...axis([0, 0, 0], [tiny, 3 * tiny, -2 * tiny])]).toEqual([0.5, 1.5, -1]);
    const largestSubnormal = Math.fround(2 ** -126 - tiny);
    expect([...axis([0, 0, 0], [largestSubnormal, 0, 0])]).toEqual([
      Math.fround(largestSubnormal / 2 ** -127),
      0,
      0,
    ]);
    expect([...axis([0, 0, 0], [2 ** -126, 0, 0])]).toEqual([1, 0, 0]);
  });

  it('exposes subdominant double rounding instead of promising old CPU packing', () => {
    const start: Point = [0, -(2 ** -50), 0];
    const end: Point = [2 ** 126, 2 ** -24, 0];
    const actual = axis(start, end);
    expect([...actual]).toEqual([1, 0, 0]);
    expect(bits(actual)).toEqual(bits(axis(end, start)));
    // Both endpoints are stored Float32, but their exact difference needs more bits.
    const exactMinor = 2 ** -24 + 2 ** -50;
    expect(Math.fround(exactMinor)).toBe(2 ** -24);
    expect(Math.fround(Math.fround(exactMinor) / 2 ** 126)).toBe(0);
    expect(Math.fround(exactMinor / 2 ** 126)).toBe(2 ** -149); // c7 CPU-only order.
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

  it.each([2, 20_003])('shares all %i fat source rows without a lazy axis allocation', (count) => {
    const positions = new Float32Array(count * 6);
    for (let index = 0; index < count; index += 1) {
      positions.set([0, 0, -25, 100, 0, 25], index * 6);
    }
    positions.set([100, 0, 25, 0, 0, -25], (count - 1) * 6);
    const before = positions.slice();
    const full = new LineSegmentsGeometry().setPositions(positions);
    full.setAttribute(
      'instanceShown',
      new three.InstancedBufferAttribute(new Uint16Array(count).fill(65535), 1, true),
    );
    full.instanceCount = 1; // A drawn prefix never replaces the ID source endpoints.
    const scenes: three.Scene[] = [];
    const renderer = {
      getRenderTarget: () => null,
      getClearColor: (target: three.Color) => target.set(0),
      getClearAlpha: () => 0,
      setRenderTarget: () => undefined,
      setClearColor: () => undefined,
      clear: () => undefined,
      render: (scene: three.Scene) => scenes.push(scene),
      readRenderTargetPixels: (
        _target: unknown,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        pixels: Uint8Array,
      ) => pixels.fill(0),
    };
    const picker = createToolpathPicker(
      { three, LineMaterial, LineSegments2, LineSegmentsGeometry } as never,
      { renderer: renderer as never, scene: new three.Scene(), width: 800, height: 600 },
    );
    picker.setTargets({
      solid: { geometry: full },
      travelGhost: null,
      travelSource: new Uint32Array(),
      travelVisible: false,
      planarDensity: null,
      positions,
    } as never);
    expect(scenes).toHaveLength(0); // Geometry remains lazy until the first pointer.
    const camera = new three.OrthographicCamera(-60, 60, 45, -45, 0.1, 1000);
    const pointer = { xPx: 400, yPx: 300, widthPx: 800, heightPx: 600 };
    expect(picker.pick(camera, pointer)).toBeNull();
    const idLine = scenes[0]?.children[0] as LineSegments2;
    expect(idLine).toBeInstanceOf(LineSegments2);
    expect(idLine.geometry.instanceCount).toBe(count);
    expect(idLine.geometry.getAttribute('instanceStart')).toBe(full.getAttribute('instanceStart'));
    expect(idLine.geometry.getAttribute('instanceEnd')).toBe(full.getAttribute('instanceEnd'));
    expect(idLine.geometry.getAttribute('instanceStart').count).toBe(count);
    expect(idLine.geometry.getAttribute(PICK_SOURCE_AXIS_ATTRIBUTE)).toBeUndefined();
    expect(full.getAttribute(PICK_SOURCE_AXIS_ATTRIBUTE)).toBeUndefined();
    expect(full.instanceCount).toBe(1);
    expect(positions).toEqual(before);
    expect(picker.pick(camera, pointer)).toBeNull();
    expect(scenes[1]?.children[0]).toBe(idLine);
    expect(idLine.geometry.getAttribute(PICK_SOURCE_AXIS_ATTRIBUTE)).toBeUndefined();
    picker.dispose();
    full.dispose();
  });

  it('duplicates native pair bits and reuses descriptor/position buffers on repeated picks', () => {
    const positions = new Float32Array([100, 0, 25, 0, 0, -25]);
    const before = positions.slice(),
      position = new three.BufferAttribute(positions, 3);
    const geometry = new three.BufferGeometry().setAttribute('position', position);
    const result = addPickSourceAxes(three, geometry);
    expect(result).toBeInstanceOf(three.BufferAttribute);
    expect(result).not.toBeInstanceOf(three.InstancedBufferAttribute);
    expect(result.count).toBe(2);
    expect(result.array.byteLength).toBe(24);
    expect(bits(result.array as Float32Array).slice(0, 3)).toEqual(
      bits(result.array as Float32Array).slice(3),
    );
    expect(addPickSourceAxes(three, geometry)).toBe(result);
    expect(geometry.getAttribute('position')).toBe(position);
    expect(position.array).toBe(positions);
    expect(positions).toEqual(before);
    geometry.dispose();
  });
});
