import { describe, expect, it } from 'vitest';
import { clearedCapsuleInterval } from './cleared-capsule-interval';
import { distanceToLine } from './vcarve-removal.test-support';

describe('continuous already-cleared capsule intervals', () => {
  it('agrees with independent segment projection across seeded orientations and endpoint discs', () => {
    let seed = 0x20260912;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const point = () => ({ x: random() * 8 - 4, y: random() * 8 - 4 });
    for (let i = 0; i < 300; i += 1) {
      const a = point();
      const b = point();
      const c = point();
      const d = i % 7 === 0 ? c : point();
      const radius = 0.01 + random() * 2;
      const interval = clearedCapsuleInterval(a, b, { ax: c.x, ay: c.y, bx: d.x, by: d.y }, radius);
      const parameters = Array.from({ length: 37 }, (_, j) => j / 36);
      if (interval !== null) parameters.push(interval.low, interval.high);
      for (const t of parameters) {
        const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const distance = distanceToLine(q, c, d);
        const covered = interval !== null && t >= interval.low && t <= interval.high;
        if (covered) expect(distance).toBeLessThanOrEqual(radius + 1e-12);
        else expect(distance).toBeGreaterThanOrEqual(radius - 1e-12);
      }
    }
  });
});
