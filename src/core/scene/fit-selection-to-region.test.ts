import { describe, expect, it } from 'vitest';
import { createRectangle } from '../shapes/primitives';
import { fitSelectionToRegion } from './fit-selection-to-region';
import { combinedBBox, transformedBBox } from './hit-test';
import { IDENTITY_TRANSFORM, type Bounds } from './scene-object';

const REGION: Bounds = { minX: 100, minY: 200, maxX: 200, maxY: 250 };

describe('fitSelectionToRegion', () => {
  it('grows and centers one object proportionally inside the requested margin', () => {
    const [fitted] = fitSelectionToRegion([rectangle('art', 20, 10, 0)], REGION, {
      marginFraction: 0.9,
      grow: true,
    });

    expect(fitted).toBeDefined();
    const bounds = transformedBBox(fitted!);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(90);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(45);
    expect(centerOf(bounds)).toEqual(centerOf(REGION));
  });

  it('fits multiple objects as one layout and preserves their relative spacing', () => {
    const fitted = fitSelectionToRegion(
      [rectangle('left', 20, 10, 0), rectangle('right', 20, 10, 30)],
      REGION,
      { marginFraction: 0.9, grow: true },
    );

    const bounds = combinedBBox(fitted);
    if (bounds === null) throw new Error('fitted selection bounds missing');
    expect(bounds.maxX - bounds.minX).toBeCloseTo(90);
    expect(centerOf(bounds)).toEqual(centerOf(REGION));
    const left = transformedBBox(fitted[0]!);
    const right = transformedBBox(fitted[1]!);
    expect(right.minX - left.maxX).toBeCloseTo(18);
  });

  it('does not grow a smaller selection when grow is false', () => {
    const [fitted] = fitSelectionToRegion([rectangle('art', 20, 10, 0)], REGION, {
      marginFraction: 0.9,
      grow: false,
    });

    expect(fitted?.transform.scaleX).toBe(1);
    expect(fitted?.transform.scaleY).toBe(1);
    expect(centerOf(transformedBBox(fitted!))).toEqual(centerOf(REGION));
  });

  it('returns a degenerate selection unchanged', () => {
    const object = rectangle('flat', 0, 10, 0);
    expect(fitSelectionToRegion([object], REGION, { marginFraction: 0.9, grow: true })).toEqual([
      object,
    ]);
  });
});

function rectangle(id: string, widthMm: number, heightMm: number, x: number) {
  return createRectangle({
    id,
    color: '#0000ff',
    spec: { widthMm, heightMm, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y: 0 },
  });
}

function centerOf(bounds: Bounds): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
