import { describe, expect, it } from 'vitest';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import { reliefWaterlinePasses, type ReliefWaterlineOptions } from './relief-waterline';
import { waterlinePath } from './relief-waterline-path';
import {
  ballKernel,
  CELL_MM,
  coneMap,
  exactSurface,
  plateauFaceCentreX,
  plateauMap,
  reachesIntoWall,
  sampledMap,
} from './relief-waterline.test-support';
import { waterlineContours } from './relief-waterline-contours';

// ADR-423: waterline passes on steep walls.

const OPTIONS: ReliefWaterlineOptions = {
  kernel: ballKernel(),
  steepAngleDeg: 45,
  levelStepMm: 0.4,
  wallOnRight: true,
  maxLinkMm: 6.35,
};

function planned(map = plateauMap(), options: Partial<ReliefWaterlineOptions> = {}) {
  const kernel = options.kernel ?? OPTIONS.kernel;
  return reliefWaterlinePasses(map, dilateHeightmapByTool(map, kernel, 0), {
    ...OPTIONS,
    ...options,
  });
}

// Each plan takes a second or two, so the default ones are planned once.
const PLANS = new Map<string, ReturnType<typeof planned>>();
function plannedOnce(name: 'plateau' | 'cone'): ReturnType<typeof planned> {
  const cached = PLANS.get(name) ?? planned(name === 'plateau' ? plateauMap() : coneMap());
  PLANS.set(name, cached);
  return cached;
}

describe('reliefWaterlinePasses (ADR-423)', { timeout: 30_000 }, () => {
  it('circles a boss at every level, top down, in one stay-down pass', () => {
    const passes = plannedOnce('cone');

    expect(passes).toHaveLength(1);
    const levels = [...new Set(passes[0]?.points.map((point) => point.z))];
    // Levels at multiples of 0.4 mm below stock top, from the first below
    // the boss's rounded rim down to the last above the floor.
    expect(levels.length).toBeGreaterThanOrEqual(11);
    for (const z of levels) expect(Math.abs(z / 0.4 - Math.round(z / 0.4))).toBeLessThan(1e-9);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(Math.min(...levels)).toBeGreaterThan(-6);
  });

  it('never reaches into the model by more than the emit grid', () => {
    for (const [name, map] of [
      ['plateau', plateauMap()],
      ['cone', coneMap()],
    ] as const) {
      // 0.001 mm on each checked move, plus margin for the probe's spacing.
      const surface = exactSurface(map, OPTIONS.kernel);
      expect(reachesIntoWall(plannedOnce(name), surface, 0.0015)).toBe(false);
    }
  });

  it('keeps the wall on the right unless asked for the other side', () => {
    const right = plannedOnce('cone');
    const left = planned(coneMap(), { wallOnRight: false });
    const turn = (points: ReadonlyArray<{ x: number; y: number }>): number => {
      // Winding about the boss centre: negative is clockwise in map numbers.
      let sum = 0;
      for (let k = 1; k < points.length; k += 1) {
        const a = points[k - 1];
        const b = points[k];
        if (a === undefined || b === undefined) continue;
        sum += (a.x - 14) * (b.y - 14) - (b.x - 14) * (a.y - 14);
      }
      return sum;
    };

    expect(turn(right[0]?.points ?? [])).toBeLessThan(0);
    expect(turn(left[0]?.points ?? [])).toBeGreaterThan(0);
  });

  it('leaves shallow slopes and masked maps to the raster', () => {
    const gentle = sampledMap(60, (x) => -1 - 0.5 * x * 0.3);
    const masked = { ...coneMap(), inclusion: new Uint8Array(100 * 100).fill(1) };
    masked.inclusion[0] = 0;

    expect(planned(gentle)).toEqual([]);
    expect(planned(masked)).toEqual([]);
  });

  it('finishes a vertical wall at the level spacing', () => {
    const passes = plannedOnce('plateau');
    // Along the face x = 9 the passes step down the wall 0.4 mm apart.
    const onFace = (passes[0]?.points ?? []).filter((p) => p.x < 8);
    const heights = [...new Set(onFace.map((p) => p.z))].sort((a, b) => b - a);
    for (let k = 1; k < heights.length; k += 1) {
      expect((heights[k - 1] ?? 0) - (heights[k] ?? 0)).toBeCloseTo(0.4, 9);
    }
    expect(heights.length).toBeGreaterThanOrEqual(9);
  });
});

describe('waterlinePath (ADR-423)', () => {
  const map = plateauMap();
  const surface = exactSurface(map, OPTIONS.kernel);
  const options = { z: -3, surface, checkSpacingMm: CELL_MM / 4, toleranceMm: 0.002 };

  it('reduces a straight run of the wall to its ends', () => {
    const x = plateauFaceCentreX(-3) - 0.0005;
    // Up the face x = 9 with the wall on the right, as the contours run.
    const face = Array.from({ length: 20 }, (_, k) => ({ x, y: 12.2 + k * 0.2 }));
    const path = waterlinePath(face, false, options);

    expect(path).toEqual([
      { x, y: 12.2, z: -3 },
      { x, y: 12.2 + 19 * 0.2, z: -3 },
    ]);
  });

  it('adds vertices off the wall where a move would cut a corner', () => {
    const tip = dilateHeightmapByTool(map, OPTIONS.kernel, 0);
    const [loop] = waterlineContours(map, tip, -3, new Uint8Array(100 * 100).fill(1), surface);
    // The contour's arc round the plateau's near corner, and a chord across it.
    const arc = (loop?.points ?? []).filter((p) => p.x < 9 && p.y < 9 && p.x > 7.6 && p.y > 7.6);
    const chord = [arc[0], arc[arc.length - 1]].filter((p) => p !== undefined);
    expect(arc.length).toBeGreaterThan(3);
    expect(
      surface.clears(
        ((chord[0]?.x ?? 0) + (chord[1]?.x ?? 0)) / 2,
        ((chord[0]?.y ?? 0) + (chord[1]?.y ?? 0)) / 2,
        -3,
      ),
    ).toBe(false);

    const path = waterlinePath(chord, false, options);

    expect(path.length).toBeGreaterThan(2);
    const pass = {
      kind: 'path3d' as const,
      points: path,
      closed: false,
      lateralFeed: 'z-rate-capped' as const,
    };
    expect(reachesIntoWall([pass], surface, 0.0015)).toBe(false);
  });

  it('lifts a move it cannot push off the wall over the model', () => {
    const across = [
      { x: 7, y: 14 },
      { x: 21, y: 14 },
    ];
    const path = waterlinePath(across, false, options);
    const pass = {
      kind: 'path3d' as const,
      points: path,
      closed: false,
      lateralFeed: 'z-rate-capped' as const,
    };

    expect(Math.max(...path.map((point) => point.z))).toBeGreaterThanOrEqual(-1 - 1e-6);
    expect(reachesIntoWall([pass], surface, 0.0015)).toBe(false);
  });

  it('closes a closed contour back on its first vertex', () => {
    const square = [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
    ];
    const path = waterlinePath(square, true, { ...options, z: -5.9 });

    expect(path[0]).toEqual(path[path.length - 1]);
  });
});
