import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type PathTextSettings, type SceneObject } from '../scene';
import type { TextRenderResult } from './text-to-polylines';
import { pathTextAcrossFromBaseline, placeTextOnPath } from './text-on-path';

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

  // L3-P2-5: a variable record lies where the template's baseline lies, not
  // on its own ink bottom, so a name with descenders keeps the same line.
  it('lays a record by the template baseline when given one', () => {
    const settings = { guideObjectId: 'guide', offsetMm: 0, reverse: false } as const;
    // The template's baseline is 1 mm above its ink bottom.
    const template = { ...TEXT, anchor: { x: 0, y: 4 } };
    const across = pathTextAcrossFromBaseline(template, settings);
    expect(across).toBe(1);
    // A record whose descenders reach 3 mm below the same baseline.
    const record: TextRenderResult = {
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 7 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 7 },
                { x: 0, y: 7 },
              ],
            },
          ],
        },
      ],
      anchor: { x: 0, y: 4 },
    };
    const own = placeTextOnPath(record, GUIDE, settings);
    const shared = placeTextOnPath(record, GUIDE, settings, across);
    if (own.kind !== 'ok' || shared.kind !== 'ok') throw new Error('placement refused');
    // Its own ink bottom sits on the guide; the template's baseline rule lifts
    // nothing and lowers the record 2 mm so its baseline matches.
    expect(own.origin.y + own.rendered.bounds.maxY).toBeCloseTo(50, 12);
    expect(shared.origin.y + shared.rendered.bounds.maxY).toBeCloseTo(52, 12);
  });
});
