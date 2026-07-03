import { describe, expect, it } from 'vitest';
import { cellBoundary, edgePattern, primaryOwnsCell } from './edge-pattern';

describe('edgePattern', () => {
  it('fits an odd cell count near the target width', () => {
    const pattern = edgePattern({ fullSpanMm: 40, thicknessMm: 5, targetFingerWidthMm: 10 });
    expect(pattern.cellCount).toBe(3);
    expect(pattern.cellWidthMm).toBe(10);
    expect(pattern.interiorSpanMm).toBe(30);
  });

  it('rounds an even raw count down to odd', () => {
    // interior 60 / target 10 = 6 cells raw → 5 odd.
    const pattern = edgePattern({ fullSpanMm: 66, thicknessMm: 3, targetFingerWidthMm: 10 });
    expect(pattern.cellCount).toBe(5);
    expect(pattern.cellWidthMm).toBe(12);
  });

  it('clamps an oversized target down to a third of the span', () => {
    const pattern = edgePattern({ fullSpanMm: 40, thicknessMm: 5, targetFingerWidthMm: 100 });
    expect(pattern.cellCount).toBe(3);
  });

  it('clamps an undersized target up to the thickness', () => {
    const pattern = edgePattern({ fullSpanMm: 40, thicknessMm: 5, targetFingerWidthMm: 0.1 });
    // clamp → 5 mm → floor(30/5) = 6 → 5 cells.
    expect(pattern.cellCount).toBe(5);
    expect(pattern.cellWidthMm).toBe(6);
  });

  it('falls back to a single full-span cell when three minimum cells cannot fit', () => {
    const pattern = edgePattern({ fullSpanMm: 16, thicknessMm: 5, targetFingerWidthMm: 10 });
    expect(pattern.cellCount).toBe(1);
    expect(pattern.cellWidthMm).toBe(6);
  });

  it('always returns an odd count across a sweep', () => {
    for (let span = 12; span <= 400; span += 7) {
      const pattern = edgePattern({ fullSpanMm: span, thicknessMm: 3, targetFingerWidthMm: 8 });
      expect(pattern.cellCount % 2).toBe(1);
      expect(pattern.cellWidthMm * pattern.cellCount).toBeCloseTo(span - 6, 9);
    }
  });
});

describe('cellBoundary', () => {
  const pattern = edgePattern({ fullSpanMm: 40, thicknessMm: 5, targetFingerWidthMm: 10 });

  it('pins the outermost boundaries to the exact interior expressions', () => {
    expect(cellBoundary(pattern, 0)).toBe(pattern.interiorStartMm);
    expect(cellBoundary(pattern, pattern.cellCount)).toBe(pattern.interiorEndMm);
    expect(cellBoundary(pattern, 0)).toBe(5);
    expect(cellBoundary(pattern, 3)).toBe(35);
  });

  it('spaces interior boundaries by the cell width', () => {
    expect(cellBoundary(pattern, 1)).toBe(15);
    expect(cellBoundary(pattern, 2)).toBe(25);
  });
});

describe('primaryOwnsCell', () => {
  it('gives even cells to the primary panel, keeping ends symmetric', () => {
    expect(primaryOwnsCell(0)).toBe(true);
    expect(primaryOwnsCell(1)).toBe(false);
    expect(primaryOwnsCell(2)).toBe(true);
    expect(primaryOwnsCell(4)).toBe(true);
  });
});
