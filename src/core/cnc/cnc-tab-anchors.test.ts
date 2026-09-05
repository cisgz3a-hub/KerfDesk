import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
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

  it.each([
    { scaleX: 2, scaleY: 2 },
    { scaleX: 2, scaleY: 1 },
    { scaleX: 0.5, scaleY: 3 },
    { scaleX: 2, scaleY: 1, mirrorX: true, rotationDeg: 37 },
    { scaleX: -2, scaleY: 1, mirrorY: true, rotationDeg: 90 },
  ])('persists the local edge position through transform %j', (changes) => {
    const transform = { ...IDENTITY_TRANSFORM, x: 50, y: 70, ...changes };
    const object = { ...OBJECT, transform };
    const anchor = projectCncTabAnchor(
      object,
      '#ff0000',
      applyTransform({ x: 12, y: 5 }, transform),
    );
    expect(anchor?.pathT).toBeCloseTo(0.375, 9);
    const actual = cncTabAnchorPosition(object, anchor!);
    const expected = applyTransform({ x: 10, y: 5 }, transform);
    expect(actual?.x).toBeCloseTo(expected.x, 9);
    expect(actual?.y).toBeCloseTo(expected.y, 9);
  });

  it.each([0, 37])('chooses the nearest edge in scene space after rotation %s', (rotationDeg) => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 200,
      y: 100,
      scaleX: 10,
      scaleY: 1,
      mirrorX: true,
      rotationDeg,
    };
    const object = { ...OBJECT, transform };
    // Locally the left edge is nearest (2 mm); on screen the bottom edge is
    // nearest (4 mm versus 20 mm). The saved fraction still uses local lengths.
    const anchor = projectCncTabAnchor(
      object,
      '#ff0000',
      applyTransform({ x: 2, y: 4 }, transform),
    );
    expect(anchor?.pathT).toBeCloseTo(0.05, 9);
    const actual = cncTabAnchorPosition(object, anchor!);
    const expected = applyTransform({ x: 2, y: 0 }, transform);
    expect(actual?.x).toBeCloseTo(expected.x, 9);
    expect(actual?.y).toBeCloseTo(expected.y, 9);
  });
});
