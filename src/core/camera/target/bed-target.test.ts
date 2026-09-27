import { describe, expect, it } from 'vitest';
import { bedTargetLayout, markAt, type BedTargetArea } from './bed-target';

// The farthest any ring reaches outside `area`, mm; 0 when all are inside.
function overhangMm(area: BedTargetArea): number {
  const layout = bedTargetLayout({ area });
  const radius = layout.ringDiameterMm / 2;
  return Math.max(
    0,
    ...layout.marks.flatMap((mark) => [
      area.x - (mark.x - radius),
      area.y - (mark.y - radius),
      mark.x + radius - (area.x + area.width),
      mark.y + radius - (area.y + area.height),
    ]),
  );
}

describe('bedTargetLayout', () => {
  it('keeps the usual 40 mm grid of 10 mm rings on an ordinary bed', () => {
    const layout = bedTargetLayout({ area: { x: 5, y: 5, width: 390, height: 390 } });
    expect(layout.spacingMm).toBe(40);
    expect(layout.ringDiameterMm).toBe(10);
    expect(layout.marks).toHaveLength(100);
  });

  it.each([
    [{ x: 5, y: 5, width: 90, height: 90 }],
    [{ x: 0, y: 0, width: 100, height: 100 }],
    [{ x: 5, y: 5, width: 190, height: 60 }],
    [{ x: 5, y: 5, width: 60, height: 190 }],
    [{ x: 5, y: 5, width: 40, height: 40 }],
  ])('fits every ring inside a small area %o', (area) => {
    expect(overhangMm(area)).toBeLessThan(1e-9);
  });

  it('shrinks rings and spacing together, keeping the anchor L, on a 100 mm bed', () => {
    const layout = bedTargetLayout({ area: { x: 5, y: 5, width: 90, height: 90 } });
    expect(layout.spacingMm).toBeLessThan(40);
    expect(layout.spacingMm / layout.ringDiameterMm).toBeCloseTo(4);
    expect(layout.marks).toHaveLength(20);
    expect(markAt(layout, 0, 0)?.anchor).toBe(true);
    expect(markAt(layout, 1, 0)?.anchor).toBe(true);
    expect(markAt(layout, 0, 2)?.anchor).toBe(true);
    expect(layout.marks.filter((mark) => mark.anchor)).toHaveLength(3);
  });
});
