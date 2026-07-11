// Regression guard for the ARC-02 self-audit finding: converting the ops from
// throwing to a Result removed the store's old catch-all, so a throw from the
// clipper2-ts engine (pathological/degenerate geometry) would escape uncaught.
// The ops now catch that third-party throw at the boundary and return
// `operation-failed`. With clipper mocked to throw, each op must return an error
// Result — not propagate the throw.

import { describe, expect, it, vi } from 'vitest';

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const boom = (): never => {
    throw new Error('clipper boom');
  };
  return {
    ...actual,
    unionD: boom,
    differenceD: boom,
    intersectD: boom,
    xorD: boom,
    inflatePathsD: boom,
  };
});

import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { combineVectorObjects, offsetVectorObjects } from './vector-path-booleans';
import { dogboneVectorObject } from './dogbone';
import { weldVectorObjects } from './vector-path-tools';

function rect(id: string, x0: number, y0: number, x1: number, y1: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 },
            ],
          },
        ],
      },
    ],
  };
}

const A = rect('a', 0, 0, 10, 10);
const B = rect('b', 5, 0, 15, 10);

describe('vector ops surface a clipper throw as operation-failed (never propagate it)', () => {
  it('combine', () => {
    const result = combineVectorObjects([A, B], 'subtract', 'out');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });

  it('offset', () => {
    const result = offsetVectorObjects([A], 2, 'out');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });

  it('weld', () => {
    const result = weldVectorObjects([A, B], 'welded');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });

  it('dogbone', () => {
    const result = dogboneVectorObject(A, 6.35);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('operation-failed');
  });
});
