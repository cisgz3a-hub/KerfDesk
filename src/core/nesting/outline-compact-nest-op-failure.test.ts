import { describe, expect, it, vi } from 'vitest';

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    intersectD: vi.fn((): never => {
      throw new Error('clipper boom');
    }),
  };
});

import { compactOutlineNest, type OutlineNestItem } from './outline-compact-nest';
import { quickNest } from './quick-nest';
import { intersectD } from 'clipper2-ts';

describe('outlineNest third-party failure boundary', () => {
  it('retains the supplied conservative placements when Clipper rejects compaction', () => {
    const item: OutlineNestItem = {
      id: 'part',
      width: 20,
      height: 10,
      canRotate: false,
      outline: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 0, y: 10 },
        ],
      ],
    };
    const bin = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const items = [item, { ...item, id: 'other' }];
    const rectangles = quickNest(bin, items, { padding: 2 });
    expect(rectangles.ok).toBe(true);
    if (!rectangles.ok) return;
    expect(compactOutlineNest(bin, items, rectangles.placements, { padding: 2 })).toEqual(
      rectangles.placements,
    );
    expect(intersectD).toHaveBeenCalled();
  });
});
