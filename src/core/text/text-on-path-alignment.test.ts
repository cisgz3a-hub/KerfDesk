import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type PathTextSettings, type SceneObject } from '../scene';
import type { TextRenderResult } from './text-to-polylines';
import { placeTextOnPath } from './text-on-path';

// A straight 100 mm guide along y = 50 and a 20 × 5 mm block of text, so every
// alignment lands on round numbers (Y grows downward).
const GUIDE: SceneObject = {
  kind: 'imported-svg',
  id: 'guide',
  source: 'line.svg',
  bounds: { minX: 0, minY: 50, maxX: 100, maxY: 50 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
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
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 5 },
            { x: 0, y: 5 },
          ],
        },
      ],
    },
  ],
};

function place(settings: Partial<PathTextSettings>) {
  return placeTextOnPath(TEXT, GUIDE, {
    guideObjectId: 'guide',
    offsetMm: 0,
    reverse: false,
    ...settings,
  });
}

function worldBox(settings: Partial<PathTextSettings>) {
  const result = place(settings);
  if (result.kind !== 'ok') throw new Error(result.message);
  const { origin, rendered } = result;
  return {
    minX: origin.x,
    maxX: origin.x + rendered.bounds.maxX,
    minY: origin.y,
    maxY: origin.y + rendered.bounds.maxY,
  };
}

describe('path text alignment (ADR-480)', () => {
  it('keeps the old placement when no alignment is set: from the start, on top of the path', () => {
    expect(worldBox({})).toEqual({ minX: 0, maxX: 20, minY: 45, maxY: 50 });
    expect(worldBox({ alongAlign: 'start', acrossAlign: 'above' })).toEqual(worldBox({}));
  });

  it('centres the text on the path length and lets the offset push it forward', () => {
    expect(worldBox({ alongAlign: 'middle' })).toMatchObject({ minX: 40, maxX: 60 });
    expect(worldBox({ alongAlign: 'middle', offsetMm: 10 })).toMatchObject({ minX: 50, maxX: 70 });
  });

  it('ends the text at the path end and measures the offset back from there', () => {
    expect(worldBox({ alongAlign: 'end' })).toMatchObject({ minX: 80, maxX: 100 });
    expect(worldBox({ alongAlign: 'end', offsetMm: 5 })).toMatchObject({ minX: 75, maxX: 95 });
  });

  it('runs the path through the middle of the text or along its top', () => {
    expect(worldBox({ acrossAlign: 'center' })).toMatchObject({ minY: 47.5, maxY: 52.5 });
    expect(worldBox({ acrossAlign: 'below' })).toMatchObject({ minY: 50, maxY: 55 });
  });

  it('reports text that the offset pushes past either end', () => {
    expect(place({ alongAlign: 'middle', offsetMm: 41 })).toMatchObject({ kind: 'text-too-long' });
    expect(place({ alongAlign: 'end', offsetMm: 81 })).toMatchObject({ kind: 'text-too-long' });
    expect(place({ alongAlign: 'end', offsetMm: 80 }).kind).toBe('ok');
  });
});
