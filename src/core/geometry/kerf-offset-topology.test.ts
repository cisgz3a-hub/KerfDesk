import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { offsetClosedPolylinesForKerfChecked } from './kerf-offset';
import { normalizeClosedPolylineTreeEvenOddChecked } from './polygon-difference';

describe('kerf offset topology invariance', () => {
  it.each([
    ['nested', [square(0, 0, 30), square(5, 5, 10)]],
    ['overlapping', [square(0, 0, 20), square(10, 5, 20)]],
    ['touching', [square(0, 0, 20), square(20, 0, 10)]],
    [
      'bow-tie',
      [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
            { x: 20, y: 0 },
          ],
        },
      ],
    ],
  ])('is invariant for %s contours across order, winding, and cyclic start', (_name, source) => {
    const variants = [
      source,
      [...source].reverse(),
      source.map((polyline) => ({ ...polyline, points: [...polyline.points].reverse() })),
      source.map((polyline) => ({ ...polyline, points: rotate(polyline.points, 2) })),
    ];
    const signatures = variants.map((variant) => {
      const offset = offsetClosedPolylinesForKerfChecked(variant, 0.5);
      expect(offset.kind).toBe('ok');
      if (offset.kind !== 'ok') return 'error';
      const topology = normalizeClosedPolylineTreeEvenOddChecked(offset.value);
      expect(topology.kind).toBe('ok');
      return topology.kind === 'ok' ? topologySignature(topology.value) : 'error';
    });
    expect(new Set(signatures)).toHaveLength(1);
  });
});

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function rotate(points: ReadonlyArray<Vec2>, count: number): ReadonlyArray<Vec2> {
  const start = count % points.length;
  return [...points.slice(start), ...points.slice(0, start)];
}

function topologySignature(
  nodes: ReadonlyArray<{ readonly contour: Polyline; readonly isHole: boolean }>,
): string {
  return JSON.stringify(
    nodes
      .map((node) => ({ hole: node.isHole, points: canonicalPoints(node.contour.points) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

function canonicalPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<string> {
  const encoded = points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`);
  const candidates = [...rotations(encoded), ...rotations([...encoded].reverse())];
  return candidates.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0] ?? [];
}

function rotations(points: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> {
  return points.map((_, index) => [...points.slice(index), ...points.slice(0, index)]);
}
