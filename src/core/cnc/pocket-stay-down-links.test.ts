// ADR-491 (CNC gap audit CW-01): pocket rings and raster rows step over at the
// plunge feed instead of lifting to safe Z and plunging again, but only where
// the step provably stays inside the pocket and away from its walls.
import { describe, expect, it } from 'vitest';
import type { CncContourPass, CncHelicalContourPass, CncPass, CncPath3dPass } from '../job';
import type { Polyline, Vec2 } from '../scene';
import { nearestRingStart, pocketPassLinks, stayDownPocketPasses } from './pocket-stay-down-links';

const RADIUS = 3;

function square(minX: number, minY: number, size: number): Vec2[] {
  return [
    { x: minX, y: minY },
    { x: minX + size, y: minY },
    { x: minX + size, y: minY + size },
    { x: minX, y: minY + size },
    { x: minX, y: minY },
  ];
}

function ring(minX: number, minY: number, size: number, zMm = -2): CncContourPass {
  return { kind: 'contour', zMm, polyline: square(minX, minY, size), closed: true };
}

function row(from: Vec2, to: Vec2, zMm = -2): CncContourPass {
  return { kind: 'contour', zMm, polyline: [from, to], closed: false };
}

function boundary(...loops: Vec2[][]): Polyline[] {
  return loops.map((points) => ({ closed: true, points: points.slice(0, -1) }));
}

const POCKET = boundary(square(0, 0, 40));

function links(passes: ReadonlyArray<CncPass>): CncPath3dPass[] {
  return passes.filter(
    (pass): pass is CncPath3dPass => pass.kind === 'path3d' && pass.stayDownLink === true,
  );
}

describe('stayDownPocketPasses', () => {
  it('links nested rings at the same depth and re-starts each at its point nearest the bit', () => {
    const inner = ring(17, 17, 6);
    const outer = ring(14, 14, 12);
    const out = stayDownPocketPasses([inner, outer], { boundary: POCKET, toolRadiusMm: RADIUS });

    expect(out).toHaveLength(3);
    expect(out[0]).toBe(inner);
    const link = out[1] as CncPath3dPass;
    expect(link).toMatchObject({ kind: 'path3d', lateralFeed: 'plunge', stayDownLink: true });
    // Straight down to the outer ring's bottom side, not across to its corner.
    expect(link.points).toEqual([
      { x: 17, y: 17, z: -2 },
      { x: 17, y: 14, z: -2 },
    ]);
    const linked = out[2] as CncContourPass;
    expect(linked.stayDownEntry).toBe(true);
    expect(linked.polyline[0]).toEqual({ x: 17, y: 14 });
    expect(linked.polyline.at(-1)).toEqual({ x: 17, y: 14 });
  });

  it('keeps the lift when the step is longer than one bit diameter', () => {
    const passes = [ring(17, 17, 6), ring(8, 8, 24)];
    expect(stayDownPocketPasses(passes, { boundary: POCKET, toolRadiusMm: RADIUS })).toEqual(
      passes,
    );
  });

  it('keeps the lift between depths, so every level still enters on its own', () => {
    const passes = [ring(17, 17, 6, -2), ring(14, 14, 12, -4)];
    expect(links(stayDownPocketPasses(passes, { boundary: POCKET, toolRadiusMm: RADIUS }))).toEqual(
      [],
    );
  });

  it('never links across an island the step would pass within a radius of', () => {
    // Two rows either side of a thin island: the straight step crosses it.
    const island = boundary(square(0, 0, 60), [
      { x: 20, y: 9 },
      { x: 40, y: 9 },
      { x: 40, y: 11 },
      { x: 20, y: 11 },
      { x: 20, y: 9 },
    ]);
    const passes = [row({ x: 5, y: 5 }, { x: 30, y: 6 }), row({ x: 30, y: 14 }, { x: 5, y: 14 })];
    expect(links(stayDownPocketPasses(passes, { boundary: island, toolRadiusMm: RADIUS }))).toEqual(
      [],
    );
  });

  it('runs an open row from its nearer end when only that end is in reach', () => {
    const first = row({ x: 5, y: 5 }, { x: 35, y: 5 });
    const second = row({ x: 5, y: 9 }, { x: 35, y: 9 });
    const out = stayDownPocketPasses([first, second], { boundary: POCKET, toolRadiusMm: RADIUS });
    expect((out[2] as CncContourPass).polyline).toEqual([
      { x: 35, y: 9 },
      { x: 5, y: 9 },
    ]);
  });

  it('pulls a pass forward past one that shares no stock with it', () => {
    // Rows of two separate arms interleave in the plan: left, right, left.
    const left1 = row({ x: 5, y: 5 }, { x: 12, y: 5 });
    const right1 = row({ x: 28, y: 5 }, { x: 35, y: 5 });
    const left2 = row({ x: 12, y: 9 }, { x: 5, y: 9 });
    const out = stayDownPocketPasses([left1, right1, left2], {
      boundary: POCKET,
      toolRadiusMm: RADIUS,
    });
    expect(out.map((pass) => pass.kind)).toEqual(['contour', 'path3d', 'contour', 'contour']);
    expect((out[2] as CncContourPass).polyline[0]).toEqual({ x: 12, y: 9 });
    expect(out[3]).toBe(right1);
  });

  it('never pulls a pass forward past one within a bit diameter of it', () => {
    // The skipped row sits next to the candidate: cutting out of order would
    // change how much stock each takes.
    const first = row({ x: 5, y: 5 }, { x: 12, y: 5 });
    const between = row({ x: 14, y: 13 }, { x: 35, y: 13 });
    const candidate = row({ x: 12, y: 9 }, { x: 5, y: 9 });
    const out = stayDownPocketPasses([first, between, candidate], {
      boundary: POCKET,
      toolRadiusMm: RADIUS,
    });
    expect(out.slice(0, 2)).toEqual([first, between]);
  });

  it('turns a linked helical-entry ring into a plain ring at depth', () => {
    const helical: CncHelicalContourPass = {
      kind: 'helical-contour',
      start: { x: 14, y: 14 },
      center: { x: 16, y: 14 },
      clockwise: false,
      startZMm: 0,
      zMm: -2,
      revolutions: 2,
      polyline: square(14, 14, 12),
      closed: true,
    };
    const out = stayDownPocketPasses([ring(17, 17, 6), helical], {
      boundary: POCKET,
      toolRadiusMm: RADIUS,
    });
    expect(out[2]).toMatchObject({ kind: 'contour', zMm: -2, closed: true, stayDownEntry: true });
  });

  it('keeps every cut exactly once', () => {
    const passes = [
      row({ x: 5, y: 5 }, { x: 12, y: 5 }),
      row({ x: 28, y: 5 }, { x: 35, y: 5 }),
      row({ x: 12, y: 9 }, { x: 5, y: 9 }),
      row({ x: 35, y: 9 }, { x: 28, y: 9 }),
    ];
    const cuts = stayDownPocketPasses(passes, { boundary: POCKET, toolRadiusMm: RADIUS }).filter(
      (pass): pass is CncContourPass => pass.kind === 'contour',
    );
    const key = (pass: CncContourPass): string =>
      pass.polyline
        .map((point) => `${point.x},${point.y}`)
        .sort()
        .join(' ');
    expect(cuts.map(key).sort()).toEqual(passes.map(key).sort());
  });
});

describe('pocketPassLinks', () => {
  it('leaves the passes alone when the layer asks for the lift between rings', () => {
    const passes = [ring(17, 17, 6), ring(14, 14, 12)];
    expect(pocketPassLinks(passes, POCKET, { pocketLiftBetweenRings: true }, 2 * RADIUS)).toBe(
      passes,
    );
    expect(links(pocketPassLinks(passes, POCKET, {}, 2 * RADIUS))).toHaveLength(1);
  });
});

describe('nearestRingStart', () => {
  it('re-starts a ring on the nearest point of its nearest side, keeping its direction', () => {
    expect(nearestRingStart(square(0, 0, 10), { x: 12, y: 4 })).toEqual([
      { x: 10, y: 4 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
    ]);
  });

  it('snaps a start within a hundredth of a millimetre onto the corner', () => {
    expect(nearestRingStart(square(0, 0, 10), { x: 12, y: 0.004 })[0]).toEqual({ x: 10, y: 0 });
  });
});
