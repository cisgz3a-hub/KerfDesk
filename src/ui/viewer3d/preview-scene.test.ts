import { describe, expect, it } from 'vitest';
import { withRoom } from './preview-scene';

const box = (minY: number, maxY: number) => ({
  minX: 0,
  minY,
  minZ: -1,
  maxX: 100,
  maxY,
  maxZ: 0,
});

describe('preview framing (ADR-485)', () => {
  it('frames the first batch exactly', () => {
    expect(withRoom(null, box(0, 10))).toEqual(box(0, 10));
  });

  it('leaves half the job again past the side the job grew across, and only there', () => {
    expect(withRoom(box(0, 10), box(0, 20))).toEqual(box(0, 30));
    expect(withRoom(box(0, 10), box(-10, 10))).toEqual(box(-20, 10));
  });

  it('reframes a job read row by row only a few times', () => {
    let framed: ReturnType<typeof withRoom> | null = null;
    let reframes = 0;
    for (let rows = 1; rows <= 3000; rows += 1) {
      const job = box(0, rows * 0.05);
      if (framed !== null && job.maxY <= framed.maxY) continue;
      framed = withRoom(framed, job);
      reframes += 1;
    }
    expect(reframes).toBeLessThan(25);
  });
});
