import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { cncTabAnchorPosition, projectCncTabAnchor, seedCncTabAnchors } from './cnc-tab-anchors';

const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    },
  ],
};

describe('CNC tab anchors', () => {
  it('seeds normalized positions and keeps them attached through transforms', () => {
    const anchors = seedCncTabAnchors(OBJECT, '#ff0000', 4);
    expect(anchors.map((anchor) => anchor.pathT)).toEqual([0.125, 0.375, 0.625, 0.875]);
    const moved = { ...OBJECT, transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30 } };
    expect(cncTabAnchorPosition(moved, anchors[0]!)).toEqual({ x: 25, y: 30 });
  });

  it('projects a dragged point to the nearest contour position', () => {
    const anchor = projectCncTabAnchor(OBJECT, '#ff0000', { x: 12, y: 5 });
    expect(anchor).toMatchObject({ pathIndex: 0, polylineIndex: 0 });
    expect(anchor?.pathT).toBeCloseTo(0.375, 6);
    expect(cncTabAnchorPosition(OBJECT, anchor!)).toEqual({ x: 10, y: 5 });
  });
});
