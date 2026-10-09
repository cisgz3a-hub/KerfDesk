import * as three from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it, vi } from 'vitest';
import {
  addDepthPlanes,
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
  writeDepthPlane,
} from './line-depth-plane-geometry';

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

function fat(segments: readonly Segment[]): LineSegmentsGeometry {
  return new LineSegmentsGeometry().setPositions(new Float32Array(segments.flat()));
}

function native(segments: readonly Segment[]): three.BufferGeometry {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute(
    'position',
    new three.BufferAttribute(new Float32Array(segments.flat()), 3),
  );
  return geometry;
}

describe('physical plane attributes', () => {
  const segments: readonly Segment[] = [
    [0, 0, 0, 100, 0, 1],
    [100, 0, 1, 0, 0, 0],
    [3, 7, 2, 6, 11, 7],
    [5, 7, -4, 5, 7, 8],
    [10, 4, 2, 30, -8, 2],
  ];

  it('adds three instanced descriptor buffers at 36 bytes per instance without position or colour copies', () => {
    const geometry = fat(segments);
    geometry.setColors(new Float32Array(segments.length * 6).fill(0.5));
    const start = geometry.getAttribute('instanceStart');
    const end = geometry.getAttribute('instanceEnd');
    const colour = geometry.getAttribute('instanceColorStart');
    const before = Object.keys(geometry.attributes);
    const attribute = addDepthPlanes(three, geometry, 'fat');
    const residual = geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE);
    expect(attribute).toBeInstanceOf(three.InstancedBufferAttribute);
    expect(attribute.array).toBeInstanceOf(Float32Array);
    expect(attribute.itemSize).toBe(4);
    expect(attribute.count).toBe(segments.length);
    expect(attribute.normalized).toBe(false);
    expect(attribute.array.byteLength).toBe(segments.length * 16);
    expect(residual).toBeInstanceOf(three.InstancedBufferAttribute);
    expect(residual.array).toBeInstanceOf(Float32Array);
    expect(residual.itemSize).toBe(1);
    expect(residual.count).toBe(segments.length);
    expect(residual.normalized).toBe(false);
    expect(residual.array.byteLength).toBe(segments.length * 4);
    expect((residual as three.InstancedBufferAttribute).meshPerAttribute).toBe(1);
    expect((attribute as three.InstancedBufferAttribute).meshPerAttribute).toBe(1);
    expect(geometry.getAttribute('instanceStart')).toBe(start);
    expect(geometry.getAttribute('instanceEnd')).toBe(end);
    expect(geometry.getAttribute('instanceColorStart')).toBe(colour);
    expect(Object.keys(geometry.attributes)).toEqual([
      ...before,
      DEPTH_PLANE_ATTRIBUTE,
      DEPTH_PLANE_OFFSET_ATTRIBUTE,
      DEPTH_PLANE_ORIGIN_ATTRIBUTE,
    ]);
    for (const [index, segment] of segments.entries())
      expect([...attribute.array.slice(index * 4, index * 4 + 4)]).toEqual([...plane(segment)]);
    geometry.dispose();
  });

  it('duplicates the descriptor companions for native vertices at 72 bytes per pair', () => {
    const geometry = native(segments);
    const position = geometry.getAttribute('position');
    const array = position.array;
    const attribute = addDepthPlanes(three, geometry, 'native');
    const residual = geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE);
    expect(attribute).toBeInstanceOf(three.BufferAttribute);
    expect(attribute).not.toBeInstanceOf(three.InstancedBufferAttribute);
    expect(attribute.count).toBe(segments.length * 2);
    expect(attribute.itemSize).toBe(4);
    expect(attribute.normalized).toBe(false);
    expect(attribute.array.byteLength).toBe(segments.length * 32);
    expect(residual).toBeInstanceOf(three.BufferAttribute);
    expect(residual).not.toBeInstanceOf(three.InstancedBufferAttribute);
    expect(residual.array).toBeInstanceOf(Float32Array);
    expect(residual.itemSize).toBe(1);
    expect(residual.count).toBe(segments.length * 2);
    expect(residual.normalized).toBe(false);
    expect(residual.array.byteLength).toBe(segments.length * 8);
    expect(geometry.getAttribute('position')).toBe(position);
    expect(position.array).toBe(array);
    for (const [index, segment] of segments.entries()) {
      const values = attribute.array as Float32Array;
      expect([...values.slice(index * 8, index * 8 + 4)]).toEqual([...plane(segment)]);
      expect(new Uint8Array(values.buffer, index * 32, 16)).toEqual(
        new Uint8Array(values.buffer, index * 32 + 16, 16),
      );
      const low = residual.array as Float32Array;
      expect(new Uint8Array(low.buffer, index * 8, 4)).toEqual(
        new Uint8Array(low.buffer, index * 8 + 4, 4),
      );
    }
    geometry.dispose();
  });

  it.each(['fat', 'native'] as const)('reads actual uploaded Float32 endpoints for %s', (kind) => {
    const raw: Segment = [4, 9, 1 + 2 ** -25, 20, -3, 1 + 2 ** -24];
    const geometry = kind === 'fat' ? fat([raw]) : native([raw]);
    const attribute = addDepthPlanes(three, geometry, kind);
    // Both raw Z values round to the same uploaded value; their double values differ.
    expect(raw[2]).not.toBe(raw[5]);
    expect([...attribute.array]).toEqual(
      kind === 'fat' ? [0, 0, 1, -1] : [0, 0, 1, -1, 0, 0, 1, -1],
    );
    expect([...geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array]).toEqual(
      kind === 'fat' ? [0] : [0, 0],
    );
    geometry.dispose();
  });

  it.each(['fat', 'native'] as const)(
    'reuses the immutable %s descriptor without rescanning positions',
    (kind) => {
      const geometry = kind === 'fat' ? fat(segments) : native(segments);
      const attribute = addDepthPlanes(three, geometry, kind);
      const residual = geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE);
      const positions = geometry.getAttribute(kind === 'fat' ? 'instanceStart' : 'position');
      const getX = vi.spyOn(positions, 'getX').mockImplementation(() => {
        throw new Error('Unexpected rescan');
      });
      expect(addDepthPlanes(three, geometry, kind)).toBe(attribute);
      expect(geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE)).toBe(attribute);
      expect(geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE)).toBe(residual);
      expect(getX).not.toHaveBeenCalled();
      getX.mockRestore();
      geometry.dispose();
    },
  );

  it('leaves an unmatched native vertex at the zero fallback descriptor', () => {
    const geometry = native([[0, 0, 0, 50, 0, 0.5]]);
    geometry.setAttribute(
      'position',
      new three.BufferAttribute(new Float32Array([0, 0, 0, 50, 0, 0.5, 3, 4, 5]), 3),
    );
    const attribute = addDepthPlanes(three, geometry, 'native');
    expect(attribute.count).toBe(3);
    expect([...attribute.array.slice(8)]).toEqual([0, 0, 0, 0]);
    expect(geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array[2]).toBe(0);
    geometry.dispose();
  });

  it.each(['fat', 'native'] as const)(
    'allocates an empty %s descriptor for empty source attributes',
    (kind) => {
      const geometry = new three.BufferGeometry();
      if (kind === 'fat') {
        geometry.setAttribute(
          'instanceStart',
          new three.InstancedBufferAttribute(new Float32Array(), 3),
        );
        geometry.setAttribute(
          'instanceEnd',
          new three.InstancedBufferAttribute(new Float32Array(), 3),
        );
      } else geometry.setAttribute('position', new three.BufferAttribute(new Float32Array(), 3));
      const attribute = addDepthPlanes(three, geometry, kind);
      expect(attribute.count).toBe(0);
      expect(attribute.array.byteLength).toBe(0);
      expect(geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array.byteLength).toBe(0);
      expect(addDepthPlanes(three, geometry, kind)).toBe(attribute);
      geometry.dispose();
    },
  );

  it.each(['fat', 'native'] as const)(
    'stores and shares the large-origin %s residual without a position copy',
    (kind) => {
      const input: Segment = [1e8, 0, 0.25, 1e8 + 8, 0, 1.25];
      const geometry = kind === 'fat' ? fat([input]) : native([input]);
      const positions = geometry.getAttribute(kind === 'fat' ? 'instanceStart' : 'position');
      const originalArray = positions.array;
      const attribute = addDepthPlanes(three, geometry, kind);
      const residual = geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE);
      expect([...residual.array]).toEqual(kind === 'fat' ? [-0.25] : [-0.25, -0.25]);
      expect(positions.array).toBe(originalArray);
      const origin = geometry.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE);
      const shared = new three.BufferGeometry();
      shared.setAttribute(DEPTH_PLANE_ATTRIBUTE, attribute);
      shared.setAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE, residual);
      shared.setAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE, origin);
      // No source positions on this shared geometry: reuse must need neither a scan nor a copy.
      expect(addDepthPlanes(three, shared, kind)).toBe(attribute);
      expect(shared.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE)).toBe(residual);
      expect(shared.getAttribute(DEPTH_PLANE_ATTRIBUTE).array).toBe(attribute.array);
      expect(shared.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array).toBe(residual.array);
      expect(shared.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE)).toBe(origin);
      expect(shared.getAttribute(DEPTH_PLANE_ORIGIN_ATTRIBUTE).array).toBe(origin.array);
      geometry.dispose();
      shared.dispose();
    },
  );

  it.each([DEPTH_PLANE_ATTRIBUTE, DEPTH_PLANE_OFFSET_ATTRIBUTE])(
    'repairs a missing %s while retaining the other buffer',
    (missing) => {
      const geometry = native([[1e8, 0, 0.25, 1e8 + 8, 0, 1.25]]);
      const attribute = addDepthPlanes(three, geometry, 'native');
      const residual = geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE);
      geometry.deleteAttribute(missing);
      const rebuilt = addDepthPlanes(three, geometry, 'native');
      if (missing === DEPTH_PLANE_ATTRIBUTE)
        expect(geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE)).toBe(residual);
      else expect(rebuilt).toBe(attribute);
      expect([...geometry.getAttribute(DEPTH_PLANE_OFFSET_ATTRIBUTE).array]).toEqual([
        -0.25, -0.25,
      ]);
      expect([...rebuilt.array]).toEqual([-0.125, 0, 1, 12_500_000, -0.125, 0, 1, 12_500_000]);
      geometry.dispose();
    },
  );
});
