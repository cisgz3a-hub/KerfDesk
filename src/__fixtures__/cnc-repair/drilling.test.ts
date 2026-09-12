import { describe, expect, it } from 'vitest';
import { estimateJobDuration } from '../../core/job/estimate-duration';
import { cncDurationOverhead } from '../../core/job/cnc-duration-overhead';
import { compiled, device, square, xyLength } from './motion-fixture';

describe('O2: explicit drilling motion, preview and duration', () => {
  it.each([
    [1, 1.5, [-1]],
    [1.5, 1.5, [-1.5]],
    [2.5, 1, [-1, -2, -2.5]],
    [0.02, 0.01, [-0.01, -0.02]],
  ] as const)('emits depth %s / step %s with every requested peck', (depth, step, expected) => {
    const { moves, preview, output, job } = compiled({
      cutType: 'drill',
      depthMm: depth,
      depthPerPassMm: step,
      plungeMmPerMin: 120,
    });
    const plunges = moves.filter((move) => move.mode === 1 && move.to.z < move.from.z);
    const drilling = plunges.filter((move) => move.to.z < 0);
    expect(drilling.map((move) => move.to.z)).toEqual(expected);
    expect(
      drilling.every((move) => move.to.x === 60 && move.to.y === 60 && xyLength(move) === 0),
    ).toBe(true);
    expect(drilling.every((move) => move.feed === 120)).toBe(true);
    expect(output.preflight.issues.some((issue) => issue.code === 'empty-output')).toBe(false);
    const cut = preview.steps.find((entry) => entry.kind === 'cut');
    if (cut?.kind !== 'cut') throw new Error('drill preview missing');
    const previewDepths = cut.zs?.filter((z) => z < 0) ?? [];
    expect(previewDepths).toHaveLength(expected.length);
    expected.forEach((depth, index) => expect(previewDepths[index]).toBeCloseTo(depth, 7));
    const feedDistance = moves
      .filter((move) => move.mode === 1)
      .reduce((sum, move) => sum + Math.abs(move.to.z - move.from.z), 0);
    // The XYZ planner may add acceleration time; it must include every
    // vertical peck and clear instead of pricing their zero XY projection.
    const estimate = estimateJobDuration(job, device);
    expect(estimate.breakdown.cutSeconds).toBeGreaterThanOrEqual((feedDistance / 120) * 60 - 1e-8);
    const overhead = cncDurationOverhead(job, device);
    expect(overhead.retractSeconds).toBeCloseTo(((5 + depth) / device.maxFeed) * 60, 8);
  });

  it('grows cutting time with the requested single plunge depth', () => {
    const shallow = compiled({ cutType: 'drill', depthMm: 1, depthPerPassMm: 10 });
    const deep = compiled({ cutType: 'drill', depthMm: 6, depthPerPassMm: 10 });
    expect(estimateJobDuration(deep.job, device).breakdown.cutSeconds).toBeGreaterThan(
      estimateJobDuration(shallow.job, device).breakdown.cutSeconds,
    );
  });

  it('keeps holes independent and retracts before traversing between them', () => {
    const { moves } = compiled({ cutType: 'drill', depthMm: 1, depthPerPassMm: 2 }, [
      square(10, 20),
      square(70, 90),
    ]);
    const holes = moves.filter((move) => move.mode === 1 && move.to.z === -1);
    expect(holes.map((move) => [move.to.x, move.to.y])).toEqual([
      [15, 15],
      [80, 80],
    ]);
    for (const move of moves.filter((entry) => entry.mode === 0 && xyLength(entry) > 0)) {
      expect(Math.min(move.from.z, move.to.z)).toBeGreaterThanOrEqual(5);
    }
  });
});
