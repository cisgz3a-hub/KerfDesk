import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { CncPass, CncPath3dPass } from '../job';
import type { CncTool, Polyline, Vec2 } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefRoughingLadder } from './relief-roughing';
import { chainLoops } from './relief-roughing-chain.test-support';
import { reliefRoughingMotion, type ReliefRoughingLevelPaths } from './relief-roughing-motion';

// ADR-424: relief roughing cuts each piece inside out, links its loops at
// depth where the link stays in the proven region, keeps every loop's stock on
// the cut direction's side, and ramps in when asked.

const CUT_WIDTH_MM = 3.175;
const STEP_MM = 1.27;

function rect(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

function level(
  region: ReadonlyArray<Polyline>,
  zMm = -1,
  sliceTopMm = 0,
): ReliefRoughingLevelPaths {
  const ladder = buildOffsetLadder(region, 4096, (step) => step * STEP_MM);
  return {
    zMm,
    sliceTopMm,
    region,
    linkRegion: region,
    rings: ladder.rings,
    cleanup: [],
    cleanupStockInside: [],
  };
}

function contourLoops(passes: ReadonlyArray<CncPass>): ReadonlyArray<ReadonlyArray<Vec2>> {
  return passes.flatMap((pass) => (pass.kind === 'contour' ? chainLoops(pass.polyline) : []));
}

function areaOf(loop: ReadonlyArray<Vec2>): number {
  return signedAreaMm2(loop.slice(0, -1));
}

function inRegion(point: Vec2, region: ReadonlyArray<Polyline>): boolean {
  return region.filter((contour) => pointInPolygon(point, contour.points)).length % 2 === 1;
}

describe('reliefRoughingMotion', () => {
  it('cuts a square level inside out in one chain, every loop closed', () => {
    const square = level([rect(0, 0, 20, 20)]);
    const passes = reliefRoughingMotion([square], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM });

    expect(passes).toHaveLength(1);
    const loops = contourLoops(passes);
    expect(loops).toHaveLength(square.rings.flat().length);
    expect(loops.flat()).toHaveLength(
      passes[0]?.kind === 'contour' ? passes[0].polyline.length : 0,
    );
    // Innermost first, each next loop one stepover further out.
    const areas = loops.map((loop) => Math.abs(areaOf(loop)));
    for (let index = 1; index < areas.length; index += 1) {
      expect(areas[index]).toBeGreaterThan(areas[index - 1] ?? 0);
    }
  });

  it('keeps the stock right of travel for climb and left for conventional', () => {
    const square = level([rect(0, 0, 20, 20)]);
    const climb = contourLoops(
      reliefRoughingMotion([square], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM }),
    );
    const conventional = contourLoops(
      reliefRoughingMotion([square], { stockOnRight: false, cutWidthMm: CUT_WIDTH_MM }),
    );

    // Inside out, a ring's stock lies outside it: anticlockwise keeps the
    // outside on the right in these numbers.
    for (const loop of climb) expect(areaOf(loop)).toBeGreaterThan(0);
    for (const loop of conventional) expect(areaOf(loop)).toBeLessThan(0);
  });

  it('circles an island the other way round, so it climbs there too', () => {
    const framed = level([rect(0, 0, 30, 30), rect(12, 12, 18, 18)]);
    const loops = contourLoops(
      reliefRoughingMotion([framed], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM }),
    );
    const centre = { x: 15, y: 15 };
    // Rings round the island reach at most 8.1 mm from its middle along X or
    // Y before they meet the outer boundary's, which stay 9.9 mm out or more.
    const nearIsland = loops.filter((loop) =>
      loop.every(
        (point) => Math.max(Math.abs(point.x - centre.x), Math.abs(point.y - centre.y)) < 9,
      ),
    );
    const outer = loops.filter((loop) => !nearIsland.includes(loop));

    expect(nearIsland.length).toBeGreaterThan(0);
    expect(outer.length).toBeGreaterThan(0);
    for (const loop of nearIsland) expect(areaOf(loop)).toBeLessThan(0);
    for (const loop of outer) expect(areaOf(loop)).toBeGreaterThan(0);
  });

  it('stays down from a piece outline to its island however far', () => {
    // Rings round a 2 mm island in a 40 mm square: the step whose outline and
    // island ring are 15 mm apart is still one pass with the rest.
    const framed = level([rect(0, 0, 40, 40), rect(19, 19, 21, 21)]);
    const passes = reliefRoughingMotion([framed], {
      stockOnRight: true,
      cutWidthMm: CUT_WIDTH_MM,
    });
    const loops = contourLoops(passes);

    expect(passes).toHaveLength(1);
    expect(loops).toHaveLength(framed.rings.flat().length);
    const longest = Math.max(
      ...linkMoves(passes[0]?.kind === 'contour' ? passes[0].polyline : []).map((move) =>
        Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y),
      ),
    );
    expect(longest).toBeGreaterThan(CUT_WIDTH_MM);
  });

  it('lifts rather than link across the gap between two pieces', () => {
    // Two strips too narrow for a second ring, 2 mm apart: closer than a cut
    // width, but the gap between them is outside the region.
    const pair = level([rect(0, 0, 2, 10), rect(4, 0, 6, 10)]);
    const passes = reliefRoughingMotion([pair], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM });

    expect(passes).toHaveLength(2);
    for (const pass of passes) {
      if (pass.kind !== 'contour') throw new Error('expected contour chains');
      const xs = pass.polyline.map((point) => point.x);
      expect(Math.max(...xs) <= 2 || Math.min(...xs) >= 4).toBe(true);
    }
  });

  it('links a band across deeper cells its depth also reaches (ADR-422)', () => {
    // Two band strips with a deeper floor between them: the gap is not the
    // band's to clear, but the cutter may stand there at the band's depth.
    const band = {
      ...level([rect(0, 0, 2, 10), rect(4, 0, 6, 10)]),
      linkRegion: [rect(0, 0, 6, 10)],
    };
    const passes = reliefRoughingMotion([band], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM });

    expect(passes).toHaveLength(1);
    expect(contourLoops(passes)).toHaveLength(2);

    // Farther apart than a cut width, the link would slot through stock the
    // band has not cut: it lifts.
    const apart = {
      ...level([rect(0, 0, 2, 10), rect(12, 0, 14, 10)]),
      linkRegion: [rect(0, 0, 14, 10)],
    };
    expect(
      reliefRoughingMotion([apart], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM }),
    ).toHaveLength(2);
  });

  it('never leaves the link region between loops, on random reliefs', () => {
    const tool: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 3.175 };
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.double({ min: 2, max: 28, noNaN: true }),
            y: fc.double({ min: 2, max: 28, noNaN: true }),
            r: fc.double({ min: 2, max: 8, noNaN: true }),
            h: fc.double({ min: 1, max: 5, noNaN: true }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.integer({ min: 20, max: 90 }),
        (bumps, stepoverPercent) => {
          const ladder = reliefRoughingLadder(bumpMap(bumps), {
            tool,
            reliefDepthMm: 5,
            depthPerPassMm: 2.5,
            stepoverPercent,
            fineStepMm: 0.8,
          });
          const passes = reliefRoughingMotion(ladder.levels, {
            stockOnRight: true,
            cutWidthMm: ladder.cutWidthMm,
          });
          for (const pass of passes) {
            if (pass.kind !== 'contour') continue;
            const region = ladder.levels.find((l) => l.zMm === pass.zMm)?.linkRegion ?? [];
            for (const move of linkMoves(pass.polyline)) {
              for (const t of [0.25, 0.5, 0.75]) {
                const point = {
                  x: move.from.x + t * (move.to.x - move.from.x),
                  y: move.from.y + t * (move.to.y - move.from.y),
                };
                expect(inRegion(point, region)).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('ramps down along the first loop from the level above', () => {
    const square = level([rect(0, 0, 20, 20)], -1.5, -0.5);
    const [pass] = reliefRoughingMotion([square], {
      stockOnRight: true,
      cutWidthMm: CUT_WIDTH_MM,
      rampAngleDeg: 3,
    });
    if (pass?.kind !== 'path3d') throw new Error('expected a ramped chain');
    const ramp = rampOf(pass);

    expect(pass.lateralFeed).toBe('z-rate-capped');
    expect(ramp[0]?.z).toBe(-0.5);
    expect(ramp[ramp.length - 1]?.z).toBe(-1.5);
    const tangent = Math.tan((3 * Math.PI) / 180);
    for (let index = 1; index < ramp.length; index += 1) {
      const a = ramp[index - 1];
      const b = ramp[index];
      if (a === undefined || b === undefined) continue;
      const run = Math.hypot(b.x - a.x, b.y - a.y);
      expect(a.z - b.z).toBeGreaterThanOrEqual(0);
      expect(a.z - b.z).toBeLessThanOrEqual(run * tangent + 1e-9);
    }
    // After the ramp the loop is cut once at depth from where the ramp ended.
    const atDepth = pass.points.slice(ramp.length - 1);
    expect(atDepth.every((point) => point.z === -1.5)).toBe(true);
    expect(chainLoops(atDepth).length).toBe(square.rings.flat().length);
  });

  it('plunges into a loop too short to ramp round', () => {
    const tiny = level([rect(0, 0, 0.5, 0.5)]);
    const passes = reliefRoughingMotion([tiny], {
      stockOnRight: true,
      cutWidthMm: CUT_WIDTH_MM,
      rampAngleDeg: 3,
    });

    expect(passes).toHaveLength(1);
    expect(passes[0]?.kind).toBe('contour');
  });

  it('keeps a cleanup trace round its stock on the climb side', () => {
    const base = level([rect(0, 0, 20, 20)]);
    const trace = rect(8, 8, 12, 12);
    const withTrace = { ...base, rings: [], cleanup: [trace], cleanupStockInside: [true] };
    const [loop] = contourLoops(
      reliefRoughingMotion([withTrace], { stockOnRight: true, cutWidthMm: CUT_WIDTH_MM }),
    );

    // Stock inside and on the right: clockwise in these numbers.
    expect(areaOf(loop ?? [])).toBeLessThan(0);
  });
});

function bumpMap(
  bumps: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly h: number;
  }>,
): Heightmap {
  const cell = 0.4;
  const cells = 75;
  const depth = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      let z = -5;
      for (const bump of bumps) {
        const d = Math.hypot(x - bump.x, y - bump.y);
        if (d < bump.r) z = Math.max(z, -5 + bump.h * (1 - d / bump.r));
      }
      depth[j * cells + i] = z;
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * cell,
    heightMm: cells * cell,
    mmPerCell: cell,
    depth,
  };
}

// The moves from each loop's end to the next loop's start.
function linkMoves(points: ReadonlyArray<Vec2>): ReadonlyArray<{ from: Vec2; to: Vec2 }> {
  const loops = chainLoops(points);
  const moves: Array<{ from: Vec2; to: Vec2 }> = [];
  for (let index = 1; index < loops.length; index += 1) {
    const previous = loops[index - 1];
    const next = loops[index];
    const from = previous?.[previous.length - 1];
    const to = next?.[0];
    if (from !== undefined && to !== undefined) moves.push({ from, to });
  }
  return moves;
}

// The descending prefix of a ramped chain, down to its first point at depth.
function rampOf(pass: CncPath3dPass): CncPath3dPass['points'] {
  const bottom = pass.points[pass.points.length - 1]?.z ?? 0;
  const end = pass.points.findIndex((point) => point.z === bottom);
  return pass.points.slice(0, end + 1);
}
