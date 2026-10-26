// Laser lead guards from the second review (ADR-626): arc sag against nearby
// cuts, corners across tab gaps, shapes that only look like copies, very long
// chords, the rotary bed and one-pass jobs with an overcut.

import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { withCutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment, Job } from './job';
import { leadPath } from './laser-lead-path';
import { laserLeadBed } from './laser-lead-rotary';
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
const NO_BED = { bed: null };

function closed(points: ReadonlyArray<Vec2>, extra: Partial<CutSegment> = {}): CutSegment {
  return { polyline: [...points, points[0] as Vec2], closed: true, ...extra };
}

function square(x: number, y: number, size: number, extra: Partial<CutSegment> = {}): CutSegment {
  return closed(
    [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
    extra,
  );
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

/** The contour as line moves: it goes out as G1/G2/G3 moves on an arc machine. */
function asMoves(segment: CutSegment): CutSegment {
  return withCutArcMoves(
    segment,
    segment.polyline.slice(1).map((to) => ({ kind: 'line' as const, to })),
  );
}

function first(job: Job): CutSegment {
  const cut = job.groups[0];
  const segment = cut?.kind === 'cut' ? cut.segments[0] : undefined;
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

describe('laser lead geometry guards (ADR-626)', () => {
  it('keeps the arc as written, not just its samples, the clearance away from a nearby cut', () => {
    // A half-turn lead-in reaches its leftmost point between two samples.
    const join = { at: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, scrap: { x: 0, y: -1 } };
    const sampledMinX = Math.min(
      ...leadPath('in', join, { style: 'arc', lengthMm: 2, angleDeg: 180 }).points.map((p) => p.x),
    );
    const sweptMinX = -2 / Math.PI;
    const wall = sampledMinX - 0.202;
    expect(sweptMinX - wall).toBeLessThan(0.2);
    const cut: CutSegment = {
      polyline: [
        { x: wall, y: -5 },
        { x: wall, y: 5 },
      ],
      closed: false,
    };
    const leads = { ...LEADS, angleDeg: 180, leadOut: false };
    const done = applyLaserLeads(
      { groups: [group([asMoves(square(0, 0, 10)), cut], { laserLeads: leads })] },
      NO_BED,
    );
    // The samples alone would pass at 0.202 mm; the arc as written would not.
    expect(done.diagnostics).toEqual([
      { kind: 'laser-leads-adjusted', layerId: 'L', layerName: 'Cut', shortened: 1, omitted: 0 },
    ]);
    for (const point of first(done).polyline) expect(point.x - wall).toBeGreaterThanOrEqual(0.2);
  });

  it('reads the whole outline where a tab gap skips a corner, so a hole there leads inside', () => {
    const nesting = { forest: 'outline-run', depth: 0, topologyContour: '0' };
    // The outline's corner at (40, 0) falls in a tab gap from (30, 0) to (40, 10).
    const pieces: CutSegment[] = [
      {
        polyline: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        closed: false,
        nesting,
      },
      {
        polyline: [
          { x: 40, y: 10 },
          { x: 40, y: 40 },
          { x: 0, y: 40 },
          { x: 0, y: 0 },
        ],
        closed: false,
        nesting,
      },
    ];
    const hole = square(36, 1, 3, {
      nesting: { forest: 'hole-run', depth: 0, topologyContour: '0' },
    });
    // Compile keeps the whole outline, corner and all (CutGroup.topologyRings).
    const outline = {
      laserLeads: LEADS,
      topologyRings: [{ forest: 'outline-run', contour: '0', polyline: square(0, 0, 40).polyline }],
    };
    const done = applyLaserLeads(
      {
        groups: [group([hole], { laserLeads: { ...LEADS, lengthMm: 1 } }), group(pieces, outline)],
      },
      NO_BED,
    );
    expect(pointInPolygon(first(done).polyline[0] as Vec2, hole.polyline)).toBe(true);
  });

  it('does not take two shapes with the same bounds and length for copies', () => {
    // Two L shapes mirrored in their shared box; the hole lies inside only the second.
    const l1 = closed([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 40 },
      { x: 0, y: 40 },
    ]);
    const l2 = closed([
      { x: 40, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 0 },
      { x: 40, y: 0 },
    ]);
    const hole = square(33, 15, 4);
    const done = applyLaserLeads(
      {
        groups: [
          group([hole], { laserLeads: { ...LEADS, lengthMm: 1 } }),
          group([l1]),
          group([l2]),
        ],
      },
      NO_BED,
    );
    expect(pointInPolygon(first(done).polyline[0] as Vec2, hole.polyline)).toBe(true);
  });

  it('copes with a very long cut line and still keeps clear of it', () => {
    const line: CutSegment = {
      polyline: [
        { x: -500_000, y: -0.5 },
        { x: 500_000, y: -0.5 },
      ],
      closed: false,
    };
    const started = performance.now();
    const done = applyLaserLeads(
      { groups: [group([square(0, 0, 10), line], { laserLeads: LEADS })] },
      NO_BED,
    );
    expect(performance.now() - started).toBeLessThan(3000);
    const led = first(done);
    expect(led.closed).toBe(false);
    for (const point of led.polyline) expect(point.y).toBeGreaterThanOrEqual(-0.3 + 1e-9);
  });

  it('lets a rotary lead cross the flat bed Y edges, but not its X edges', () => {
    const bed = { minX: 0, minY: 0, maxX: 300, maxY: 300 };
    expect(laserLeadBed(bed, false)).toBe(bed);
    expect(laserLeadBed(bed, true)).toEqual({
      minX: 0,
      maxX: 300,
      minY: Number.NEGATIVE_INFINITY,
      maxY: Number.POSITIVE_INFINITY,
    });
    const job: Job = { groups: [group([square(5, 0, 10)], { laserLeads: LEADS })] };
    const rotary = first(applyLaserLeads(job, { bed: laserLeadBed(bed, true) }));
    expect((rotary.polyline[0] as Vec2).y).toBeLessThan(0);
    const flat = first(applyLaserLeads(job, { bed }));
    for (const point of flat.polyline) expect(point.y).toBeGreaterThanOrEqual(0);
  });

  it('burns only the final pass on a one-pass job with an overcut', () => {
    const done = applyLaserLeads(
      { groups: [group([square(0, 0, 10)], { laserLeads: LEADS, finalPassOvercutMm: 3 })] },
      NO_BED,
    );
    const led = first(done);
    expect(led).not.toHaveProperty('finalPassBurn');
    expect(led.polyline).toContainEqual({ x: 3, y: 0 });
    // Lead-in, the 40 mm square, the 3 mm overcut and one lead-out; the arcs'
    // chords run a few micrometres short of the arcs.
    expect(pathLength(led.polyline)).toBeCloseTo(2 + 40 + 3 + 2, 1);
  });

  it('keeps no neighbour clear of a lead-out a one-pass overcut never cuts', () => {
    // A 3 mm square below the 10 mm one, whose 1 mm corner leads reach across
    // where the 10 mm square's ordinary lead-out would run.
    const neighbour = closed([
      { x: 0.25, y: -1.45 },
      { x: 0.25, y: -4.45 },
      { x: 3.25, y: -4.45 },
      { x: 3.25, y: -1.45 },
    ]);
    const led = (passes: number) =>
      applyLaserLeads(
        {
          groups: [
            group([square(0, 0, 10)], { laserLeads: LEADS, finalPassOvercutMm: 3, passes }),
            group([neighbour], { laserLeads: { ...LEADS, lengthMm: 1 }, passes }),
          ],
        },
        NO_BED,
      );
    const onePass = led(1);
    const second = onePass.groups[1];
    const fitted = second?.kind === 'cut' ? second.segments[0] : undefined;
    expect(pathLength(fitted?.polyline ?? [])).toBeCloseTo(1 + 12 + 1, 1);
    expect(onePass.diagnostics).toBeUndefined();
    // With two passes the first pass does cut that lead-out, so it is kept clear.
    expect(led(2).diagnostics).toEqual([
      expect.objectContaining({ kind: 'laser-leads-adjusted', shortened: 1, omitted: 0 }),
    ]);
  });

  it('checks an arc lead against its own contour along the arc the machine runs', () => {
    // The square starts at its corner (0, 0). Its 2 mm arc lead-in is drawn as
    // chords, and the G2/G3 arc the machine follows bulges past them. A spike
    // of the part reaches in between the lead-in's last chord and that arc.
    const r = 4 / Math.PI;
    const drawn = leadPath(
      'in',
      { at: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, scrap: { x: 0, y: -1 } },
      { style: 'arc', lengthMm: 2, angleDeg: 90 },
    ).points;
    const before = drawn[drawn.length - 2] as Vec2;
    const chordMiddle = { x: before.x / 2, y: before.y / 2 };
    const out = Math.hypot(chordMiddle.x, chordMiddle.y + r);
    const onArc = { x: (chordMiddle.x / out) * r, y: ((chordMiddle.y + r) / out) * r - r };
    const tip = {
      x: chordMiddle.x + 0.6 * (onArc.x - chordMiddle.x),
      y: chordMiddle.y + 0.6 * (onArc.y - chordMiddle.y),
    };
    const spiked = asMoves(
      closed([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0.31 },
        tip,
        { x: 0, y: 0.3 },
      ]),
    );
    const led = first(
      applyLaserLeads(
        { groups: [group([spiked], { laserLeads: { ...LEADS, leadOut: false } })] },
        NO_BED,
      ),
    );
    // The full lead-in at the corner would cut the spike along its arc, so it
    // is shortened or the square starts elsewhere; the chords alone miss it.
    const start = led.polyline[0] as Vec2;
    expect(Math.hypot(start.x + r, start.y + r)).toBeGreaterThan(0.01);
  });

  it('never crosses a narrow tongue of its own part beside the join', () => {
    // A 10 mm square started at (1, 0), with a 0.01 mm tongue 2 mm long hanging
    // from its bottom edge just behind the start, where the lead-in arrives.
    const tongued = closed([
      { x: 1, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 0.98, y: 0 },
      { x: 0.98, y: -2 },
      { x: 0.99, y: -2 },
      { x: 0.99, y: 0 },
    ]);
    const led = first(
      applyLaserLeads(
        { groups: [group([tongued], { laserLeads: { ...LEADS, leadOut: false } })] },
        NO_BED,
      ),
    );
    // The 2 mm arc lead-in into (1, 0) would start at (1 - r, -r), r = 4/π, and
    // cut through the tongue between two of its samples, so the square starts
    // elsewhere.
    const r = 4 / Math.PI;
    const start = led.polyline[0] as Vec2;
    expect(led.closed).toBe(false);
    expect(Math.hypot(start.x - (1 - r), start.y + r)).toBeGreaterThan(1);
  });

  it('fits a lead shorter than the clearance, at every length the setting allows', () => {
    for (const leads of [
      { ...LEADS, lengthMm: 0.1 },
      { ...LEADS, style: 'line' as const, angleDeg: 45, lengthMm: 0.1 },
    ]) {
      const led = first(
        applyLaserLeads({ groups: [group([square(0, 0, 10)], { laserLeads: leads })] }, NO_BED),
      );
      expect(led.closed).toBe(false);
    }
  });

  it('keeps a lead from slipping through two tab gaps across a tabbed neighbour', () => {
    // A 0.8 mm strip right of the square, tabbed where the square's start
    // would lead straight out across it.
    const nesting = { forest: 'strip-run', depth: 0, topologyContour: '0' };
    const strip: CutSegment[] = [
      {
        polyline: [
          { x: 10.6, y: 5.5 },
          { x: 10.6, y: 10 },
          { x: 11.4, y: 10 },
          { x: 11.4, y: 5.5 },
        ],
        closed: false,
        nesting,
      },
      {
        polyline: [
          { x: 11.4, y: 4.5 },
          { x: 11.4, y: 0 },
          { x: 10.6, y: 0 },
          { x: 10.6, y: 4.5 },
        ],
        closed: false,
        nesting,
      },
    ];
    const start: Vec2 = { x: 10, y: 5 };
    const part: CutSegment = {
      polyline: [start, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }, start],
      closed: true,
    };
    const leads = { ...LEADS, style: 'line' as const, angleDeg: 90, lengthMm: 3, leadOut: false };
    const outline = closed([
      { x: 10.6, y: 0 },
      { x: 11.4, y: 0 },
      { x: 11.4, y: 10 },
      { x: 10.6, y: 10 },
    ]).polyline;
    const topologyRings = [{ forest: 'strip-run', contour: '0', polyline: outline }];
    const done = applyLaserLeads(
      { groups: [group([part], { laserLeads: leads }), group(strip, { topologyRings })] },
      NO_BED,
    );
    const led = first(done);
    expect(led.closed).toBe(false);
    for (const point of led.polyline) expect(point.x).toBeLessThanOrEqual(10.4);
  });
});
