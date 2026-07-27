import { describe, expect, it } from 'vitest';

import type { CutGroup, CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

// Split out of optimize-paths.test.ts, which sits at the 400-line hard cap.

function seg(...pts: Array<[number, number]>): CutSegment {
  return { polyline: pts.map(([x, y]) => ({ x, y })), closed: false };
}

function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
  };
}

function asCut(job: Job): CutGroup | undefined {
  const first = job.groups[0];
  return first !== undefined && first.kind === 'cut' ? first : undefined;
}

// Rapid travel between segments - the distance the head moves without cutting.
// Reordering can only be judged by whether this goes down.
function travelDistance(segments: ReadonlyArray<CutSegment>): number {
  let cursorX = 0;
  let cursorY = 0;
  let total = 0;
  for (const segment of segments) {
    const start = segment.polyline[0];
    const end = segment.polyline[segment.polyline.length - 1];
    if (start === undefined || end === undefined) continue;
    total += Math.hypot(start.x - cursorX, start.y - cursorY);
    cursorX = end.x;
    cursorY = end.y;
  }
  return total;
}

describe('optimizePaths above the former segment cap', () => {
  it('optimizes a group far larger than the old 2,000-segment limit', () => {
    // The predecessor of this test asserted the OPPOSITE - that a group this
    // large came back in source order untouched. That was the defect: traced
    // artwork routinely exceeds 2,000 segments, so the jobs with the most
    // travel to recover were exactly the ones that got none, and silently.
    const farFirst = seg([100, 100], [101, 100]);
    const nearSecond = seg([0, 0], [1, 0]);
    const filler = Array.from({ length: 3_000 }, (_, i) => seg([200 + i, 0], [201 + i, 0]));
    const job: Job = { groups: [group([farFirst, nearSecond, ...filler])] };

    const result = optimizePaths(job);
    const ordered = asCut(result)?.segments ?? [];

    expect(ordered).not.toBe(asCut(job)?.segments);
    expect(ordered).toHaveLength(3_002);
    // Nearest to the origin cursor, so it leads now instead of staying second.
    expect(ordered[0]).toBe(nearSecond);
    expect(travelDistance(ordered)).toBeLessThan(travelDistance(asCut(job)?.segments ?? []));
  });

  it('is deterministic - the same oversized input yields the same order twice', () => {
    // Non-negotiable #5. Above the old cap this was trivially true because
    // nothing was reordered; now that the optimizer actually runs, it needs
    // asserting.
    const segments = Array.from({ length: 2_500 }, (_, i) =>
      seg([(i * 37) % 400, (i * 91) % 400], [((i * 37) % 400) + 1, (i * 91) % 400]),
    );
    const job: Job = { groups: [group(segments)] };

    const first = asCut(optimizePaths(job))?.segments ?? [];
    const second = asCut(optimizePaths(job))?.segments ?? [];

    expect(first).toEqual(second);
    expect(first).toHaveLength(2_500);
  });
});
