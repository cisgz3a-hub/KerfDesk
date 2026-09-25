import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { closedCutStartMarkers } from './cut-start-markers';
import type { CutGroup, CutSegment, Group, Job } from './job';

function cutGroup(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'cut',
    color: '#ff0000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    segments,
  };
}

function job(groups: ReadonlyArray<Group>): Job {
  return { groups } as unknown as Job;
}

function closed(points: ReadonlyArray<Vec2>, startLocked = false): CutSegment {
  const first = points[0];
  if (first === undefined) throw new Error('fixture needs points');
  return {
    polyline: [...points, first],
    closed: true,
    ...(startLocked ? { startLocked: true as const } : {}),
  };
}

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('closedCutStartMarkers', () => {
  it('marks each closed cut at its first point, heading along its first edge', () => {
    const open: CutSegment = {
      polyline: [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
      ],
      closed: false,
    };
    const markers = closedCutStartMarkers(
      job([cutGroup([closed(SQUARE), open, closed([...SQUARE].reverse(), true)])]),
    );
    expect(markers).toEqual([
      { at: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, operatorSet: false },
      { at: { x: 0, y: 10 }, direction: { x: 1, y: 0 }, operatorSet: true },
    ]);
  });

  it('follows the first edge that moves and skips degenerate loops', () => {
    const repeated = closed([
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 6, y: 8 },
      { x: 0, y: 8 },
    ]);
    const collapsed = closed([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]);
    const [marker, ...rest] = closedCutStartMarkers(job([cutGroup([repeated, collapsed])]));
    expect(rest).toEqual([]);
    expect(marker?.at).toEqual({ x: 3, y: 4 });
    expect(marker?.direction.x).toBeCloseTo(0.6, 12);
    expect(marker?.direction.y).toBeCloseTo(0.8, 12);
  });

  it('ignores groups other than Line cuts and stops at the limit', () => {
    const fill = { ...cutGroup([closed(SQUARE)]), kind: 'fill', overscanMm: 0 } as unknown as Group;
    const many = cutGroup([closed(SQUARE), closed(SQUARE), closed(SQUARE)]);
    expect(closedCutStartMarkers(job([fill]))).toEqual([]);
    expect(closedCutStartMarkers(job([many]), 2)).toHaveLength(2);
  });
});
