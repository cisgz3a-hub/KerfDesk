import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import { reliefFinishingPasses, scallopRowSpacingMm } from './relief-finishing';
import {
  reliefFinishingPlan,
  reliefFinishRowSpacingMm,
  transposeHeightmap,
  type ReliefFinishingPlanOptions,
} from './relief-finishing-strategy';
import { ballKernel, BALL, CELL_MM, sampledMap } from './relief-waterline.test-support';

// ADR-423: finishing strategies and the raster direction.

// A boss with 70 degree walls off centre, so X and Y differ.
function bossMap() {
  const slope = Math.tan((70 * Math.PI) / 180);
  return sampledMap(50, (x, y) =>
    Math.max(-4, -1 - slope * Math.max(0, Math.hypot(x - 6, y - 8) - 2)),
  );
}

const OPTIONS: ReliefFinishingPlanOptions = {
  tool: BALL,
  kernel: ballKernel(),
  scallopMm: 0.025,
  strategy: 'raster',
  rasterAxis: 'x',
  wallOnRight: true,
};

// Every point of every pass, with the direction of the move into it.
function moves(passes: ReadonlyArray<CncPass>) {
  return passes.flatMap((pass) =>
    pass.kind === 'path3d'
      ? pass.points.slice(1).map((point, k) => ({ from: pass.points[k] ?? point, to: point }))
      : [],
  );
}

describe('reliefFinishRowSpacingMm (ADR-423)', () => {
  it('keeps the scallop spacing for the raster and narrows it under waterline', () => {
    const scallop = scallopRowSpacingMm(BALL, 0.025);

    expect(reliefFinishRowSpacingMm(BALL, 0.025, 'raster')).toBe(scallop);
    expect(reliefFinishRowSpacingMm(BALL, 0.025, 'raster-waterline')).toBeCloseTo(
      scallop * Math.SQRT1_2,
      12,
    );
  });
});

describe('reliefFinishingPlan (ADR-423)', { timeout: 30_000 }, () => {
  const map = bossMap();
  const tip = dilateHeightmapByTool(map, OPTIONS.kernel, 0);
  const tipAt = (x: number, y: number): number => {
    const i = Math.round(x / CELL_MM - 0.5);
    const j = Math.round(y / CELL_MM - 0.5);
    return tip[j * map.widthCells + i] ?? Number.NaN;
  };

  it('plans the raster along X exactly as before by default', () => {
    expect(reliefFinishingPlan(map, OPTIONS)).toEqual(
      reliefFinishingPasses(map, { tool: BALL, kernel: OPTIONS.kernel, scallopMm: 0.025 }),
    );
  });

  it('runs the rows along Y on the tip surface of the same map', () => {
    const passes = reliefFinishingPlan(map, { ...OPTIONS, rasterAxis: 'y' });
    const along = moves(passes);

    // The rows run along Y: the longest moves keep X.
    const longest = along.reduce((a, b) =>
      Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y) >
      Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y)
        ? b
        : a,
    );
    expect(longest.to.x).toBe(longest.from.x);
    // And each vertex rides this map's tip where it stands.
    for (const { to } of along) expect(to.z).toBe(tipAt(to.x, to.y));
  });

  it('adds waterline passes on the steep walls and narrows the raster', () => {
    const raster = reliefFinishingPlan(map, OPTIONS);
    const passes = reliefFinishingPlan(map, { ...OPTIONS, strategy: 'raster-waterline' });
    const narrowed = reliefFinishingPasses(map, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
      rowSpacingMm: reliefFinishRowSpacingMm(BALL, 0.025, 'raster-waterline'),
    });

    expect(passes.slice(0, narrowed.length)).toEqual(narrowed);
    expect(moves(narrowed).length).toBeGreaterThan(moves(raster).length);
    const waterline = passes.slice(narrowed.length);
    expect(waterline.length).toBeGreaterThan(0);
    // Levels sin(45) x the scallop row spacing apart.
    const step = scallopRowSpacingMm(BALL, 0.025) * Math.SQRT1_2;
    const levels = new Set(
      waterline.flatMap((pass) => (pass.kind === 'path3d' ? pass.points.map((p) => p.z) : [])),
    );
    for (const z of levels) {
      if (z > -1) continue; // a vertex lifted over the rim
      expect(Math.abs(z / step - Math.round(z / step))).toBeLessThan(1e-9);
    }
  });

  it('plans the same waterline whichever way the raster runs', () => {
    const x = reliefFinishingPlan(map, { ...OPTIONS, strategy: 'raster-waterline' });
    const y = reliefFinishingPlan(map, {
      ...OPTIONS,
      strategy: 'raster-waterline',
      rasterAxis: 'y',
    });
    const rows = reliefFinishingPasses(map, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
      rowSpacingMm: reliefFinishRowSpacingMm(BALL, 0.025, 'raster-waterline'),
    }).length;

    // The same waterline follows either raster.
    expect(y.slice(y.length - (x.length - rows))).toEqual(x.slice(rows));
  });

  it('leaves a masked map to the raster alone', () => {
    const masked = { ...map, inclusion: new Uint8Array(50 * 50).fill(1) };
    masked.inclusion[0] = 0;
    const narrowed = reliefFinishingPasses(masked, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
      rowSpacingMm: reliefFinishRowSpacingMm(BALL, 0.025, 'raster-waterline'),
    });

    expect(reliefFinishingPlan(masked, { ...OPTIONS, strategy: 'raster-waterline' })).toEqual(
      narrowed,
    );
  });

  it('transposes a map and its mask', () => {
    const small = { ...sampledMap(3, (x, y) => -x - 10 * y), inclusion: new Uint8Array(9) };
    small.inclusion[1] = 1; // column 1, row 0
    const flipped = transposeHeightmap(small);

    expect(flipped.depth[3]).toBe(small.depth[1]);
    expect(flipped.inclusion?.[3]).toBe(1);
    expect(transposeHeightmap(flipped)).toEqual(small);
  });
});
