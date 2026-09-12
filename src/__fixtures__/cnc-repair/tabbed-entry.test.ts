import { describe, expect, it } from 'vitest';
import { compiled, xyLength } from './motion-fixture';

describe('O1: emitted tabbed profile entry', () => {
  it('treats an explicit zero ramp as inactive and retains the selected profile lead', () => {
    const settings = {
      cutType: 'profile-outside' as const,
      depthMm: 2,
      depthPerPassMm: 2,
      profileLead: { shape: 'arc' as const },
    };
    const ordinary = compiled(settings);
    const zeroRamp = compiled({ ...settings, rampEntryDeg: 0 });
    const noLead = compiled({ ...settings, profileLead: { shape: 'none' } });
    expect(zeroRamp.moves).toEqual(ordinary.moves);
    expect(zeroRamp.moves).not.toEqual(noLead.moves);
  });

  it.each([false, true])('ramps into each new depth with tabs %s', (tabsEnabled) => {
    const { moves, preview } = compiled({
      cutType: 'profile-on-path',
      depthMm: 6,
      depthPerPassMm: 2,
      rampEntryDeg: 5,
      tabsEnabled,
      tabHeightMm: 2,
      tabWidthMm: 6,
      tabsPerShape: 4,
    });
    for (const priorDepth of [0, -2, -4]) {
      const first = moves.find((move) => move.mode === 1 && move.to.z < priorDepth);
      expect(first).toBeDefined();
      if (first === undefined) throw new Error('fresh-depth entry missing');
      expect(xyLength(first), first.line).toBeGreaterThan(0);
      expect(
        (Math.atan2(first.from.z - first.to.z, xyLength(first)) * 180) / Math.PI,
      ).toBeLessThanOrEqual(5.002);
    }
    const previewZs = preview.steps.flatMap((entry) =>
      entry.kind === 'cut' ? (entry.zs ?? []) : [],
    );
    expect(Math.min(...previewZs)).toBe(-6);
  });

  it('leaves four physical 6 mm bridges and preserves the intentional rectangular tab walls', () => {
    const { moves } = compiled({
      cutType: 'profile-on-path',
      depthMm: 6,
      depthPerPassMm: 2,
      rampEntryDeg: 5,
      tabsEnabled: true,
      tabHeightMm: 2,
      tabWidthMm: 6,
      tabsPerShape: 4,
    });
    const reached = moves.findIndex((move) => move.to.z === -6);
    const finalLoop = moves
      .slice(reached + 1)
      .filter((move) => move.mode === 1 && xyLength(move) > 0);
    // After the ramp reaches depth, the complete tab-preserving loop must
    // still run. Cutter-centre windows = bridge width + cutter diameter.
    expect(finalLoop.reduce((sum, move) => sum + xyLength(move), 0)).toBeCloseTo(80, 3);
    expect(
      finalLoop
        .filter((move) => move.from.z === -4 && move.to.z === -4)
        .reduce((sum, move) => sum + xyLength(move), 0),
    ).toBeCloseTo(40, 3);
    const walls = moves
      .slice(reached + 1)
      .filter((move) => move.from.z === -4 && move.to.z === -6 && xyLength(move) === 0);
    expect(walls).toHaveLength(4);
    expect(walls.every((move) => move.feed === 300)).toBe(true);
  });
});
