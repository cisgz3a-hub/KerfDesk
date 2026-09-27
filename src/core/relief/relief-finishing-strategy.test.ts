import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import { reliefFinishingPasses, scallopRowSpacingMm } from './relief-finishing';
import { checkedAgainstContact } from './relief-finishing-contact';
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

// Passes as the plan leaves them: every move checked against the exact
// contact (ADR-421 Amendment 1).
function checked(map: Heightmap, passes: ReadonlyArray<CncPass>): ReadonlyArray<CncPass> {
  const field = createSurfaceContactField(map, OPTIONS.kernel);
  if (field === null) throw new Error('expected a contact field');
  return checkedAgainstContact(passes, {
    tipAt: field.constraintAtPoint,
    alongMove: field.alongMove,
    spacingMm: map.mmPerCell / 4,
  });
}

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

  it('plans the raster along X as before by default', () => {
    expect(reliefFinishingPlan(map, OPTIONS)).toEqual(
      checked(
        map,
        reliefFinishingPasses(map, { tool: BALL, kernel: OPTIONS.kernel, scallopMm: 0.025 }),
      ),
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
    // And each vertex on a sample rides this map's tip there, or crosses
    // over the contact just above it.
    const onSample = along.filter(({ to }) => isCentre(to));
    for (const { to } of onSample) expect(to.z).toBeGreaterThanOrEqual(tipAt(to.x, to.y));
    expect(onSample.filter(({ to }) => to.z === tipAt(to.x, to.y)).length).toBeGreaterThan(
      0.99 * onSample.length,
    );
  });

  it('adds waterline passes on the steep walls and narrows the raster', () => {
    const passes = reliefFinishingPlan(map, { ...OPTIONS, strategy: 'raster-waterline' });
    const narrowed = reliefFinishingPasses(map, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
      rowSpacingMm: reliefFinishRowSpacingMm(BALL, 0.025, 'raster-waterline'),
    });

    expect(passes.slice(0, narrowed.length)).toEqual(checked(map, narrowed));
    const rows = reliefFinishingPasses(map, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
    });
    expect(moves(narrowed).length).toBeGreaterThan(moves(rows).length);
    const waterline = passes.slice(narrowed.length);
    expect(waterline.length).toBeGreaterThan(0);
    // Levels sin(45) x the scallop row spacing apart.
    const step = scallopRowSpacingMm(BALL, 0.025) * Math.SQRT1_2;
    // The contact check only lifts, so a pass's lowest vertex is its level.
    const levels = waterline.map((pass) =>
      pass.kind === 'path3d' ? Math.min(...pass.points.map((p) => p.z)) : Number.NaN,
    );
    for (const z of levels) {
      if (z > -1) continue; // a pass lifted over the rim
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

  it("adds waterline passes around a masked map's excluded stock (ADR-484)", () => {
    const masked = { ...map, inclusion: new Uint8Array(50 * 50).fill(1) };
    masked.inclusion[0] = 0;
    const narrowed = reliefFinishingPasses(masked, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
      rowSpacingMm: reliefFinishRowSpacingMm(BALL, 0.025, 'raster-waterline'),
    });
    const passes = reliefFinishingPlan(masked, { ...OPTIONS, strategy: 'raster-waterline' });

    expect(passes.slice(0, narrowed.length)).toEqual(checked(masked, narrowed));
    // The corner block's waterline, once the boss's.
    expect(passes.length).toBeGreaterThan(narrowed.length);
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

function isCentre(point: { readonly x: number; readonly y: number }): boolean {
  const i = point.x / CELL_MM - 0.5;
  const j = point.y / CELL_MM - 0.5;
  return Math.abs(i - Math.round(i)) < 1e-9 && Math.abs(j - Math.round(j)) < 1e-9;
}
