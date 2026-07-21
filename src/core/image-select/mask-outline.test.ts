import { describe, expect, it } from 'vitest';
import { maskOutline, type OutlinePoint } from './mask-outline';
import { createEmptyMask, MASK_SOLID } from './selection-mask';

function select(mask: ReturnType<typeof createEmptyMask>, x: number, y: number): void {
  mask.alpha[y * mask.width + x] = MASK_SOLID;
}

function pointSet(loop: readonly OutlinePoint[]): string[] {
  return loop.map((point) => `${point.x},${point.y}`).sort();
}

describe('maskOutline', () => {
  it('a single pixel yields one 4-corner loop', () => {
    const mask = createEmptyMask(6, 6);
    select(mask, 2, 3);
    const loops = maskOutline(mask);
    expect(loops).toHaveLength(1);
    expect(pointSet(loops[0] ?? [])).toEqual(['2,3', '2,4', '3,3', '3,4']);
  });

  it('collinear runs are merged: a 2x1 bar is still 4 corners', () => {
    const mask = createEmptyMask(6, 6);
    select(mask, 1, 1);
    select(mask, 2, 1);
    const loops = maskOutline(mask);
    expect(loops).toHaveLength(1);
    expect(pointSet(loops[0] ?? [])).toEqual(['1,1', '1,2', '3,1', '3,2']);
  });

  it('a ring produces separate outer and hole loops', () => {
    const mask = createEmptyMask(5, 5);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 2 && y === 2) continue;
        select(mask, x, y);
      }
    }
    const loops = maskOutline(mask);
    expect(loops).toHaveLength(2);
    const sizes = loops.map((loop) => loop.length).sort((a, b) => a - b);
    expect(sizes).toEqual([4, 4]);
  });

  it('diagonally-touching pixels (the saddle case) lose no boundary', () => {
    const mask = createEmptyMask(4, 4);
    select(mask, 0, 0);
    select(mask, 1, 1);
    const loops = maskOutline(mask);
    const totalCorners = loops.reduce((sum, loop) => sum + loop.length, 0);
    expect(totalCorners).toBe(8);
  });

  it('an empty mask has no outline', () => {
    expect(maskOutline(createEmptyMask(3, 3))).toHaveLength(0);
  });
});
