import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import type { TextRenderResult } from './text-to-polylines';
import { placeTextOnPath } from './text-on-path';

const GUIDE: SceneObject = {
  kind: 'imported-svg',
  id: 'guide',
  source: 'guide.svg',
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 20 },
            { x: 20, y: 0 },
            { x: 40, y: 20 },
          ],
        },
      ],
    },
  ],
};
const TEXT: TextRenderResult = {
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 5 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 5 },
            { x: 10, y: 0 },
            { x: 20, y: 5 },
          ],
        },
      ],
    },
  ],
};

describe('placeTextOnPath', () => {
  it('maps text by guide arc length and returns a world-space origin', () => {
    const result = placeTextOnPath(TEXT, GUIDE, {
      guideObjectId: 'guide',
      offsetMm: 0,
      reverse: false,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.origin.x).toBeLessThanOrEqual(0);
    expect(result.rendered.bounds.minX).toBe(0);
    expect(result.rendered.bounds.minY).toBe(0);
  });

  it('reverses placement direction deterministically', () => {
    const forward = placeTextOnPath(TEXT, GUIDE, {
      guideObjectId: 'guide',
      offsetMm: 0,
      reverse: false,
    });
    const reverse = placeTextOnPath(TEXT, GUIDE, {
      guideObjectId: 'guide',
      offsetMm: 0,
      reverse: true,
    });
    expect(forward.kind).toBe('ok');
    expect(reverse.kind).toBe('ok');
    if (forward.kind !== 'ok' || reverse.kind !== 'ok') return;
    expect(reverse.origin.x).toBeGreaterThan(forward.origin.x);
  });

  it('refuses text that cannot fit the guide', () => {
    expect(
      placeTextOnPath(TEXT, GUIDE, { guideObjectId: 'guide', offsetMm: 40, reverse: false }),
    ).toMatchObject({ kind: 'text-too-long' });
  });

  // Audit S7-P2-3: past about 120,000 points the bounds spread threw "Maximum
  // call stack size exceeded" (Special Elite from about 75 characters).
  it('places text with more points than a call can take as arguments', () => {
    const long = longTextRender(300_000, 40);
    const placed = placeTextOnPath(long, LONG_GUIDE, {
      guideObjectId: 'long-guide',
      offsetMm: 0,
      reverse: false,
    });
    expect(placed.kind).toBe('ok');
    if (placed.kind !== 'ok') return;
    expect(placed.rendered.paths[0]?.polylines[0]?.points).toHaveLength(300_000);
    expect(placed.rendered.bounds.minX).toBe(0);
    expect(placed.rendered.bounds.maxX).toBeGreaterThan(30);
  });
});

const LONG_GUIDE: SceneObject = {
  ...GUIDE,
  id: 'long-guide',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        },
      ],
    },
  ],
};

function longTextRender(pointCount: number, widthMm: number): TextRenderResult {
  const points = Array.from({ length: pointCount }, (_, index) => ({
    x: (index / (pointCount - 1)) * widthMm,
    y: index % 2,
  }));
  return {
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: 1 },
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
}
