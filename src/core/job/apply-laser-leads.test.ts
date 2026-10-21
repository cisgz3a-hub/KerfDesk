import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { validCutArcMoves, withCutArcMoves } from './cut-arc-moves';
import { finalPassCutSegments } from './cut-pass-segments';
import type { CutGroup, CutSegment, Job } from './job';
import type { CutGroupLaserLeads } from './laser-lead-settings';

const LEADS: CutGroupLaserLeads = {
  leadIn: true,
  leadOut: true,
  style: 'arc',
  lengthMm: 2,
  angleDeg: 90,
  side: 'auto',
  clearanceMm: 0.2,
  operationName: 'Cut',
};

/** A closed square, counter-clockwise from its lower-left corner unless `cw`. */
function square(x: number, y: number, size: number, cw = false): CutSegment {
  const corners = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  const ring = cw ? [corners[0], ...corners.slice(1).reverse()] : corners;
  return { polyline: [...(ring as Vec2[]), ring[0] as Vec2], closed: true };
}

function circle(cx: number, cy: number, r: number, count = 72): CutSegment {
  const points: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (2 * Math.PI * i) / count;
    points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { polyline: [...points, points[0] as Vec2], closed: true };
}

function group(segments: ReadonlyArray<CutSegment>, extra: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#ff0000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
    ...extra,
  };
}

function lead(job: Job, groupIndex = 0, segmentIndex = 0): CutSegment {
  const found = job.groups[groupIndex];
  if (found?.kind !== 'cut') throw new Error('expected a cut group');
  const segment = found.segments[segmentIndex];
  if (segment === undefined) throw new Error('expected a segment');
  return segment;
}

function pathLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function distanceToPolyline(point: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1] as Vec2;
    const b = polyline[i] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

const NO_BED = { bed: null };

describe('applyLaserLeads (ADR-626)', () => {
  it('returns a job without leads untouched, the very same object', () => {
    const job: Job = { groups: [group([square(0, 0, 10)])] };
    expect(applyLaserLeads(job, NO_BED)).toBe(job);
  });

  it('turns an outer square into lead-in, the whole contour, lead-out, all in the scrap', () => {
    const ring = square(0, 0, 10);
    const out = lead(applyLaserLeads({ groups: [group([ring], { laserLeads: LEADS })] }, NO_BED));
    expect(out.closed).toBe(false);
    const start = out.polyline.findIndex((p) => p === ring.polyline[0]);
    expect(start).toBeGreaterThan(0);
    // The whole ring follows the lead-in unchanged.
    expect(out.polyline.slice(start, start + ring.polyline.length)).toEqual(ring.polyline);
    const leadIn = out.polyline.slice(0, start + 1);
    const leadOut = out.polyline.slice(start + ring.polyline.length - 1);
    expect(pathLength(leadIn)).toBeCloseTo(2, 2);
    expect(pathLength(leadOut)).toBeCloseTo(2, 2);
    const square2 = ring.polyline;
    for (const point of [...leadIn.slice(0, -1), ...leadOut.slice(1)]) {
      expect(pointInPolygon(point, square2)).toBe(false);
    }
  });

  it('puts the same lead outside a clockwise outer contour', () => {
    const out = lead(
      applyLaserLeads({ groups: [group([square(0, 0, 10, true)], { laserLeads: LEADS })] }, NO_BED),
    );
    const first = out.polyline[0] as Vec2;
    expect(pointInPolygon(first, square(0, 0, 10).polyline)).toBe(false);
  });

  it('meets the cut at the set angle with a line lead, and never leaves along it', () => {
    const leads: CutGroupLaserLeads = { ...LEADS, style: 'line', angleDeg: 45 };
    const out = lead(
      applyLaserLeads({ groups: [group([square(0, 0, 10)], { laserLeads: leads })] }, NO_BED),
    );
    // At the corner (0, 0) both 45-degree leads would run along one diagonal,
    // in and straight back out, so the square starts mid-edge at (5, 0),
    // heading +X with the scrap below, where the two part.
    const points = out.polyline;
    expect(points[1]).toEqual({ x: 5, y: 0 });
    expect(points[0]?.x).toBeCloseTo(5 - Math.SQRT2, 9);
    expect(points[0]?.y).toBeCloseTo(-Math.SQRT2, 9);
    expect(points.at(-1)?.x).toBeCloseTo(5 + Math.SQRT2, 9);
    expect(points.at(-1)?.y).toBeCloseTo(-Math.SQRT2, 9);
  });

  it('never leaves a lap-long overcut along the lead-in either', () => {
    const leads: CutGroupLaserLeads = { ...LEADS, style: 'line', angleDeg: 45 };
    const done = applyLaserLeads(
      {
        groups: [group([square(0, 0, 10)], { laserLeads: leads, finalPassOvercutMm: 40 })],
      },
      NO_BED,
    );
    // The overcut ends back at the corner, where its lead-out would run out
    // along the lead-in, so the square starts mid-edge instead.
    const out = lead(done);
    expect(out.polyline[1]).toEqual({ x: 5, y: 0 });
    expect(out.polyline[0]).not.toEqual(out.polyline.at(-1));
    expect(done.diagnostics).toBeUndefined();
  });

  it('keeps an overcut lead-out that leaves short of the seam off the whole lead-in', () => {
    const job = (overcutMm: number) =>
      applyLaserLeads(
        {
          groups: [group([square(0, 0, 10)], { laserLeads: LEADS, finalPassOvercutMm: overcutMm })],
        },
        NO_BED,
      );
    // 0.5 mm short of the seam, the lead-out arc crosses the lead-in arc in
    // the scrap beside it, wherever the square starts: no lead-out fits.
    expect(job(39.5).diagnostics).toEqual([
      expect.objectContaining({ kind: 'laser-leads-adjusted', omitted: 1 }),
    ]);
    // 0.1 mm short, the two arcs leave at right angles but cross further out.
    expect(job(39.9).diagnostics).toEqual([
      expect.objectContaining({ kind: 'laser-leads-adjusted', omitted: 1 }),
    ]);
    // An ordinary overcut leaves well clear of the lead-in.
    expect(job(3).diagnostics).toBeUndefined();
  });

  it('leads a hole from inside, also when the hole is cut by another operation', () => {
    const outer = square(0, 0, 40);
    const hole = square(10, 10, 20);
    for (const job of [
      { groups: [group([hole, outer], { laserLeads: LEADS })] },
      {
        groups: [
          group([hole], { laserLeads: LEADS }),
          group([outer], { laserLeads: { ...LEADS, operationName: 'Outline' } }),
        ],
      },
    ] satisfies Job[]) {
      const done = applyLaserLeads(job, NO_BED);
      const holeLead = lead(done, 0, 0);
      expect(holeLead.closed).toBe(false);
      const first = holeLead.polyline[0] as Vec2;
      expect(pointInPolygon(first, hole.polyline)).toBe(true);
    }
  });

  it('gives a hole no lead when the outline round it is on an operation without leads', () => {
    // That outline may be a part, or only a score line or border (ADR-626 Amd 1).
    const outer = square(0, 0, 40);
    const hole = square(10, 10, 20);
    const done = applyLaserLeads(
      { groups: [group([hole], { laserLeads: LEADS }), group([outer], { layerId: 'Score' })] },
      NO_BED,
    );
    expect(lead(done, 0, 0)).toBe(hole);
    expect(done.diagnostics).toEqual([
      {
        kind: 'laser-leads-side-unknown',
        layerId: 'L',
        layerName: 'Cut',
        count: 1,
        aroundName: 'Score',
      },
    ]);
  });

  it('reads a tabbed outline cut in pieces as the contour it still is', () => {
    const outer = square(0, 0, 40).polyline;
    const nesting = { forest: 'outline-run', depth: 0, topologyContour: '0' };
    const pieces: CutSegment[] = [
      { polyline: outer.slice(0, 3), closed: false, nesting },
      { polyline: [...outer.slice(2, 5)].reverse(), closed: false, nesting },
    ];
    const hole = {
      ...square(10, 10, 20),
      nesting: { forest: 'hole-run', depth: 0, topologyContour: '0' },
    };
    // Compile keeps the whole outline (CutGroup.topologyRings); its operation
    // asks for leads, though its tabbed contour gets none.
    const outline = {
      laserLeads: LEADS,
      topologyRings: [{ forest: 'outline-run', contour: '0', polyline: outer }],
    };
    const done = applyLaserLeads(
      { groups: [group([hole], { laserLeads: LEADS }), group(pieces, outline)] },
      NO_BED,
    );
    expect(pointInPolygon(lead(done).polyline[0] as Vec2, hole.polyline)).toBe(true);
  });

  it('puts every lead outside when the operation says so, even on a hole', () => {
    const outer = square(0, 0, 40);
    const hole = square(10, 10, 20);
    const done = applyLaserLeads(
      { groups: [group([hole, outer], { laserLeads: { ...LEADS, side: 'outside' } })] },
      NO_BED,
    );
    const first = lead(done, 0, 0).polyline[0] as Vec2;
    expect(pointInPolygon(first, hole.polyline)).toBe(false);
    expect(pointInPolygon(first, outer.polyline)).toBe(true);
  });

  it('shortens a lead that does not fit a small hole, or leaves it out, and says so', () => {
    const outer = square(0, 0, 40);
    const smallHole = circle(20, 20, 1.2);
    const tinyHole = circle(30, 30, 0.2);
    const done = applyLaserLeads(
      { groups: [group([smallHole, tinyHole, outer], { laserLeads: { ...LEADS, lengthMm: 5 } })] },
      NO_BED,
    );
    const small = lead(done, 0, 0);
    expect(small.closed).toBe(false);
    const holeStart = small.polyline.findIndex((p) => p === smallHole.polyline[0]);
    expect(pathLength(small.polyline.slice(0, holeStart + 1))).toBeLessThan(5);
    // Inside the hole, or riding its chords within the curve tolerance where
    // the arc meets it tangentially.
    for (const point of small.polyline.slice(0, holeStart)) {
      const inside = pointInPolygon(point, smallHole.polyline);
      expect(inside || distanceToPolyline(point, smallHole.polyline) < 0.03).toBe(true);
    }
    // Nothing fits a hole 0.4 mm across: it is cut as before.
    expect(lead(done, 0, 1)).toBe(tinyHole);
    expect(done.diagnostics).toEqual([
      { kind: 'laser-leads-adjusted', layerId: 'L', layerName: 'Cut', shortened: 1, omitted: 1 },
    ]);
  });

  it('keeps a lead clear of a neighbouring part, shortening it or moving the start', () => {
    // The square's right edge, started half way up and heading +Y, leads in
    // from +X with a straight 2 mm line: toward a neighbour.
    const start: Vec2 = { x: 10, y: 5 };
    const part: CutSegment = {
      polyline: [start, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }, start],
      closed: true,
    };
    const leads: CutGroupLaserLeads = { ...LEADS, style: 'line', angleDeg: 90, leadOut: false };
    // A little room: the lead is shortened to fit where the planner started.
    const roomy = applyLaserLeads(
      { groups: [group([part, square(11.6, 0, 10)], { laserLeads: leads })] },
      NO_BED,
    );
    expect(lead(roomy).polyline[0]).toEqual({ x: 11, y: 5 });
    expect(roomy.diagnostics).toEqual([
      { kind: 'laser-leads-adjusted', layerId: 'L', layerName: 'Cut', shortened: 1, omitted: 0 },
    ]);
    // No room at all: the contour starts on a nearby edge with room instead.
    const neighbour = square(10.5, 0, 10);
    const near = lead(
      applyLaserLeads({ groups: [group([part, neighbour], { laserLeads: leads })] }, NO_BED),
    );
    const first = near.polyline[0] as Vec2;
    expect(near.closed).toBe(false);
    expect(first.x).toBeLessThan(10.5 - 0.2);
    expect(pointInPolygon(first, neighbour.polyline)).toBe(false);
    expect(pointInPolygon(first, part.polyline)).toBe(false);
  });

  it('starts a hole drawn from a corner in the middle of an edge, where its leads fit', () => {
    const outer = square(0, 0, 40);
    const hole = square(10, 10, 20);
    const done = applyLaserLeads({ groups: [group([hole, outer], { laserLeads: LEADS })] }, NO_BED);
    const leaded = lead(done, 0, 0);
    expect(leaded.polyline).toContainEqual({ x: 20, y: 10 });
    expect(done.diagnostics).toBeUndefined();
  });

  it('ignores a copy of the same outline cut by another operation', () => {
    const ring = square(0, 0, 10);
    const done = applyLaserLeads(
      { groups: [group([ring], { laserLeads: LEADS }), group([square(0, 0, 10)])] },
      NO_BED,
    );
    expect(lead(done).closed).toBe(false);
    expect(done.diagnostics).toBeUndefined();
  });

  it('keeps leads on the bed when the bed is known', () => {
    const bed = { minX: 0, minY: 0, maxX: 300, maxY: 300 };
    for (const ring of [square(0, 0, 10), square(5, 5, 10)]) {
      const placed = lead(
        applyLaserLeads({ groups: [group([ring], { laserLeads: LEADS })] }, { bed }),
      );
      expect(placed.closed).toBe(false);
      for (const point of placed.polyline) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
      }
    }
    // Off the bed whichever edge it starts on: cut without leads.
    const sliver: CutSegment = {
      polyline: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
        { x: 0, y: 300 },
        { x: 0, y: 0 },
      ],
      closed: true,
    };
    const full = applyLaserLeads({ groups: [group([sliver], { laserLeads: LEADS })] }, { bed });
    expect(lead(full)).toBe(sliver);
  });

  it('leaves open paths alone', () => {
    const open: CutSegment = {
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    const done = applyLaserLeads({ groups: [group([open], { laserLeads: LEADS })] }, NO_BED);
    expect(lead(done)).toBe(open);
  });

  it('runs the overcut on the final pass before a lead-out of its own', () => {
    const ring = square(0, 0, 10);
    const done = applyLaserLeads(
      { groups: [group([ring], { laserLeads: LEADS, passes: 2, finalPassOvercutMm: 3 })] },
      NO_BED,
    );
    const cut = done.groups[0];
    if (cut?.kind !== 'cut') throw new Error('expected a cut group');
    const ordinary = lead(done);
    const final = finalPassCutSegments(cut)[0] as CutSegment;
    expect(final).not.toHaveProperty('finalPassBurn');
    // The final pass runs 3 mm past the start, along the bottom edge, so its
    // lead-out leaves from (3, 0).
    expect(final.polyline).toContainEqual({ x: 3, y: 0 });
    const outIndex = final.polyline.findIndex((p) => p.x === 3 && p.y === 0);
    expect(pathLength(final.polyline.slice(outIndex))).toBeCloseTo(2, 2);
    expect(pathLength(final.polyline)).toBeCloseTo(pathLength(ordinary.polyline) + 3, 6);
  });

  it('keeps the arcs of a contour that goes out as arcs, and writes arc leads as arcs', () => {
    const ring = square(0, 0, 10);
    const withArcs = withCutArcMoves(
      ring,
      ring.polyline.slice(1).map((to) => ({ kind: 'line' as const, to })),
    );
    expect(validCutArcMoves(withArcs)).not.toBeNull();
    const out = lead(
      applyLaserLeads({ groups: [group([withArcs], { laserLeads: LEADS })] }, NO_BED),
    );
    const moves = validCutArcMoves(out);
    expect(moves).not.toBeNull();
    expect(moves?.filter((move) => move.kind === 'arc')).toHaveLength(2);
    expect(moves).toHaveLength(6);
  });
});
