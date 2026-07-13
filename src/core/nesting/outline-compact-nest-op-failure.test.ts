import { describe, expect, it, vi } from 'vitest';

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    inflatePathsD: (): never => {
      throw new Error('clipper boom');
    },
  };
});

import { outlineNest, type OutlineNestItem } from './outline-compact-nest';

describe('outlineNest third-party failure boundary', () => {
  it('returns the conservative rectangular result when Clipper throws', () => {
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
    expect(outlineNest({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, [item], { padding: 2 })).toEqual(
      {
        ok: true,
        placements: [{ id: 'part', x: 2, y: 2, rotated90: false }],
        usedOutline: false,
      },
    );
  });
});
