import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import { quickNest, subtractUsedFreeRects, type NestRect } from './quick-nest';

// The all-pairs split-and-prune the incremental version replaced.
function referenceSubtract(freeRects: ReadonlyArray<NestRect>, used: NestRect): NestRect[] {
  const intersects = (a: NestRect, b: NestRect) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  const contains = (o: NestRect, i: NestRect) =>
    o.minX <= i.minX && o.minY <= i.minY && o.maxX >= i.maxX && o.maxY >= i.maxY;
  const valid = (r: NestRect) => r.maxX - r.minX > 0 && r.maxY - r.minY > 0;
  const split = (free: NestRect): NestRect[] => {
    if (!intersects(free, used)) return [free];
    const pieces: NestRect[] = [];
    if (used.minX > free.minX) pieces.push({ ...free, maxX: Math.min(used.minX, free.maxX) });
    if (used.maxX < free.maxX) pieces.push({ ...free, minX: Math.max(used.maxX, free.minX) });
    if (used.minY > free.minY) pieces.push({ ...free, maxY: Math.min(used.minY, free.maxY) });
    if (used.maxY < free.maxY) pieces.push({ ...free, minY: Math.max(used.maxY, free.minY) });
    return pieces.filter(valid);
  };
  const rects = freeRects.flatMap(split);
  return rects.filter(
    (rect, index) => !rects.some((other, j) => j !== index && contains(other, rect)),
  );
}

describe('subtractUsedFreeRects', () => {
  it('matches the all-pairs prune, order included, over random packings', () => {
    let seed = 3;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 40; run += 1) {
      let free: NestRect[] = [{ minX: 0, minY: 0, maxX: 100, maxY: 80 }];
      for (let step = 0; step < 60 && free.length > 0; step += 1) {
        // Integer coordinates make shared edges and identical pieces common.
        const host = free[Math.floor(next() * free.length)] as NestRect;
        const minX = host.minX + Math.floor(next() * 4);
        const minY = host.minY + Math.floor(next() * 4);
        const used = {
          minX,
          minY,
          maxX: minX + 1 + Math.floor(next() * 20),
          maxY: minY + 1 + Math.floor(next() * 20),
        };
        const expected = referenceSubtract(free, used);
        free = subtractUsedFreeRects(free, used);
        expect(free).toEqual(expected);
      }
    }
  });
});

describe('quickNest at scale', () => {
  it('nests 16,000 parts without the all-pairs prune', () => {
    const items = Array.from({ length: 16_000 }, (_, i) => ({
      id: `p${i}`,
      width: 5 + (i % 7),
      height: 4 + (i % 5),
      canRotate: true,
    }));
    const started = performance.now();
    const result = quickNest({ minX: 0, minY: 0, maxX: 2000, maxY: 2000 }, items, { padding: 1 });
    const elapsed = performance.now() - started;
    expect(result.ok).toBe(true);
    // The all-pairs prune took about 14 s here; the incremental one about 0.3 s.
    expect(elapsed).toBeLessThan(ciBudgetMs(2_000, 6_000));
  });
});
