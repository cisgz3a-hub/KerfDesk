import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

describe('tolerant V-carve intersection AABB', () => {
  it('keeps a segment whose endpoint is within the accepted parameter tolerance', () => {
    const outer = rectangle(0, 0, 10, 10);
    const region: VCarveMedialRegion = { outer, holes: [], loops: [outer] };
    const almostTouching: VCarveBoundarySegment = {
      a: { x: 5, y: 5 + 5e-9 },
      b: { x: 5, y: 6 },
      loopIndex: 1,
      edgeIndex: 0,
      loopEdgeCount: 1,
    };
    const segments = [...vcarveBoundarySegments(region), almostTouching];

    expect(vcarveChordInsideRegion({ x: 1, y: 5 }, { x: 9, y: 5 }, region, segments)).toBe(false);
  });
});
