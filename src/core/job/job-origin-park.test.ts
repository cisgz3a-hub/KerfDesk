import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from './job';
import { placeCncParks } from './job-origin';

// Only the kind and park fields matter to placeCncParks.
function job(park?: { readonly x: number; readonly y: number }): Job {
  const group = {
    kind: 'cnc',
    passes: [],
    ...(park === undefined ? {} : { parkXMm: park.x, parkYMm: park.y }),
  } as unknown as CncGroup;
  return { groups: [group] } as unknown as Job;
}

function parkOf(placed: Job): { readonly x: number | undefined; readonly y: number | undefined } {
  const [group] = placed.groups as ReadonlyArray<CncGroup>;
  return { x: group?.parkXMm, y: group?.parkYMm };
}

describe('placeCncParks (ADR-392)', () => {
  it('moves a configured park from the bed into the program frame', () => {
    expect(parkOf(placeCncParks(job({ x: 0, y: 380 }), { x: -150, y: -100 }))).toEqual({
      x: -150,
      y: 280,
    });
  });

  it('drops a configured park it cannot place, so the job parks at its origin', () => {
    expect(parkOf(placeCncParks(job({ x: 0, y: 380 }), null))).toEqual({
      x: undefined,
      y: undefined,
    });
  });

  it('leaves a job without a configured park untouched', () => {
    const unparked = job();
    expect(placeCncParks(unparked, { x: 5, y: 5 })).toBe(unparked);
  });
});
