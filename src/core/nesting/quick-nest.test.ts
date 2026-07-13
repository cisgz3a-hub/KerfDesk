import { describe, expect, it } from 'vitest';
import { quickNest, type NestPlacement, type NestRect } from './quick-nest';

const bin = { minX: 0, minY: 0, maxX: 100, maxY: 60 };

describe('quickNest', () => {
  it('is deterministic, padded, and non-overlapping', () => {
    const items = [
      { id: 'B', width: 25, height: 20, canRotate: true },
      { id: 'A', width: 30, height: 10, canRotate: true },
      { id: 'C', width: 12, height: 12, canRotate: false },
    ];
    const first = quickNest(bin, items, { padding: 3 });
    expect(first).toEqual(quickNest(bin, items, { padding: 3 }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(noOverlap(first.placements, items, 3)).toBe(true);
  });

  it('uses 90 degree rotation when it is the only fit', () => {
    const result = quickNest(
      { minX: 0, minY: 0, maxX: 12, maxY: 22 },
      [{ id: 'wide', width: 20, height: 10, canRotate: true }],
      { padding: 0 },
    );
    expect(result).toMatchObject({ ok: true, placements: [{ id: 'wide', rotated90: true }] });
  });

  it('respects locked obstacles and fails atomically when an item cannot fit', () => {
    const obstacle = { minX: 0, minY: 0, maxX: 60, maxY: 60 };
    const result = quickNest(bin, [{ id: 'part', width: 50, height: 50, canRotate: false }], {
      padding: 2,
      obstacles: [obstacle],
    });
    expect(result).toEqual({ ok: false, unplacedIds: ['part'] });
  });
});

function noOverlap(
  placements: ReadonlyArray<NestPlacement>,
  items: ReadonlyArray<{ id: string; width: number; height: number }>,
  padding: number,
): boolean {
  const rects = placements.map((placement): NestRect => {
    const item = items.find((candidate) => candidate.id === placement.id)!;
    const width = placement.rotated90 ? item.height : item.width;
    const height = placement.rotated90 ? item.width : item.height;
    return {
      minX: placement.x - padding / 2,
      minY: placement.y - padding / 2,
      maxX: placement.x + width + padding / 2,
      maxY: placement.y + height + padding / 2,
    };
  });
  return rects.every((rect, index) =>
    rects.every(
      (other, otherIndex) =>
        index === otherIndex ||
        rect.maxX <= other.minX ||
        other.maxX <= rect.minX ||
        rect.maxY <= other.minY ||
        other.maxY <= rect.minY,
    ),
  );
}
