import { describe, expect, it } from 'vitest';
import { tileJobs } from '../../core/cnc/tile-plan';
import { tileRegistrationPasses } from '../../core/cnc/tile-registration-passes';
import { cncGrblStrategy } from '../../core/output/cnc-grbl-strategy';
import type { CncGroup } from '../../core/job';
import type { CncTileRegistration } from '../../core/scene/machine';
import { estimateJobDuration } from '../../core/job/estimate-duration';
import { device, motions, xyLength } from './motion-fixture';

const center = { x: 50, y: 40 };
const plan: CncTileRegistration = {
  toolId: 'registration',
  holeDiameterMm: 6,
  depthMm: 2.7,
  depthPerPassMm: 1.1,
  feedMmPerMin: 900,
  plungeMmPerMin: 140,
  spindleRpm: 12000,
};

function group(toolDiameterMm: number, holeDiameterMm: number): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'registration',
    color: '#000000',
    cutType: holeDiameterMm === toolDiameterMm ? 'drill' : 'pocket',
    toolId: plan.toolId,
    toolKind: 'end-mill',
    toolDiameterMm,
    feedMmPerMin: plan.feedMmPerMin,
    plungeMmPerMin: plan.plungeMmPerMin,
    spindleRpm: plan.spindleRpm,
    safeZMm: 5,
    spindleSpinupSec: 0,
    passes: tileRegistrationPasses(center, { ...plan, holeDiameterMm }, toolDiameterMm),
  };
}

describe('O3/O5 independent native registration removal checks', () => {
  it('includes each centre peck in the interpolated bore duration', () => {
    const job = { groups: [group(2, 3)] };
    const code = cncGrblStrategy.emit(job, device);
    const idealFeedSeconds = motions(code).reduce((seconds, move) => {
      if (move.mode === 0) return seconds;
      const radius = Math.hypot(
        Number(move.line.match(/I([-+\d.]+)/)?.[1] ?? 0),
        Number(move.line.match(/J([-+\d.]+)/)?.[1] ?? 0),
      );
      const length =
        move.mode === 1
          ? Math.hypot(xyLength(move), move.to.z - move.from.z)
          : 2 * Math.PI * radius;
      return seconds + (length / move.feed) * 60;
    }, 0);
    expect(estimateJobDuration(job, device).breakdown.cutSeconds).toBeGreaterThanOrEqual(
      idealFeedSeconds - 1e-6,
    );
  });

  it.each([
    [2, 2],
    [2, 3],
    [2, 7],
    [3.175, 8.3],
    [4, 12],
  ])(
    '%s mm cutter produces an unbroken %s mm cylindrical bore at each depth',
    (toolDiameter, holeDiameter) => {
      const code = cncGrblStrategy.emit({ groups: [group(toolDiameter, holeDiameter)] }, device);
      const emitted = motions(code);
      const plunges = emitted.filter(
        (move) =>
          move.mode === 1 &&
          move.to.z < move.from.z &&
          move.to.x === center.x &&
          move.to.y === center.y,
      );
      const levels = [...new Set(plunges.filter((move) => move.to.z < 0).map((move) => move.to.z))];
      expect(levels).toEqual([-1.1, -2.2, -2.7]);
      expect(plunges.every((move) => move.feed === plan.plungeMmPerMin)).toBe(true);
      const sweptRadii = new Map(levels.map((depth) => [depth, [0]]));
      for (const move of emitted.filter((entry) => entry.mode === 2 || entry.mode === 3)) {
        const i = Number(move.line.match(/I([-+\d.]+)/)?.[1] ?? 0);
        const j = Number(move.line.match(/J([-+\d.]+)/)?.[1] ?? 0);
        expect(move.from.x).toBe(move.to.x);
        expect(move.from.y).toBe(move.to.y);
        expect(move.from.z).toBe(move.to.z);
        expect(move.from.x + i).toBeCloseTo(center.x, 3);
        expect(move.from.y + j).toBeCloseTo(center.y, 3);
        expect(move.feed).toBe(plan.feedMmPerMin);
        sweptRadii.get(move.to.z)?.push(Math.hypot(i, j));
      }
      for (const radii of sweptRadii.values()) {
        // A full circle swept by a flat cutter removes its complete radial
        // interval. Prove the union is continuous, without a finite grid.
        const radius = toolDiameter / 2;
        let covered = 0;
        for (const centreRadius of radii.sort((a, b) => a - b)) {
          expect(Math.max(0, centreRadius - radius)).toBeLessThanOrEqual(covered + 0.001);
          covered = Math.max(covered, centreRadius + radius);
        }
        expect(covered).toBeCloseTo(holeDiameter / 2, 3);
      }
      for (const move of emitted.filter((entry) => entry.mode === 0 && xyLength(entry) > 0)) {
        expect(Math.min(move.from.z, move.to.z)).toBeGreaterThanOrEqual(5);
      }
    },
  );

  it('keeps optional registration inactive for an ordinary single indexed file', () => {
    const result = tileJobs(
      { groups: [group(2, 3)] },
      {
        tileWidthMm: 100,
        tileHeightMm: 100,
        overlapMm: 10,
        registrationHoles: true,
      },
    );
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') expect(result.tiles[0]?.job.groups).toHaveLength(1);
  });
});
