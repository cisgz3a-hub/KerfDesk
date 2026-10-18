// Laser leads against native arcs and many-piece outlines (ADR-626): a lead
// joins a G2/G3 contour along the arc's own tangent, neighbours that go out as
// arcs are measured by their sweep, and an outline cut as thousands of dashes
// still counts as a container.

import { describe, expect, it } from 'vitest';
import type { ArcMove } from '../geometry/arc-fit';
import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { validCutArcMoves, withCutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment, Job } from './job';
import { leadJobLines } from './laser-lead-rings';
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

/** A circle of radius 10 kept as a coarse octagon, but going out as four
 * quarter arcs, counter-clockwise from (cx + 10, cy). */
function arcCircle(cx: number, cy: number): CutSegment {
  const points: Vec2[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i;
    points.push({ x: cx + 10 * Math.cos(a), y: cy + 10 * Math.sin(a) });
  }
  const start = points[0] as Vec2;
  const polyline = [...points, start];
  const center = { x: cx, y: cy };
  const moves: ArcMove[] = [
    { kind: 'arc', to: { x: cx, y: cy + 10 }, center, clockwise: false },
    { kind: 'arc', to: { x: cx - 10, y: cy }, center, clockwise: false },
    { kind: 'arc', to: { x: cx, y: cy - 10 }, center, clockwise: false },
    { kind: 'arc', to: start, center, clockwise: false },
  ];
  const segment = withCutArcMoves({ polyline, closed: true }, moves);
  if (validCutArcMoves(segment) === null) throw new Error('expected valid arc moves');
  return segment;
}

function square(x: number, y: number, size: number, extra: Partial<CutSegment> = {}): CutSegment {
  const ring = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  return { polyline: [...ring, ring[0] as Vec2], closed: true, ...extra };
}

function first(job: Job): CutSegment {
  const cut = job.groups[0];
  const segment = cut?.kind === 'cut' ? cut.segments[0] : undefined;
  if (segment === undefined) throw new Error('expected a segment');
  return segment;
}

describe('laser leads with arcs and many pieces (ADR-626)', () => {
  it('joins a contour that goes out as arcs along the arc, not its first chord', () => {
    const led = first(
      applyLaserLeads({ groups: [group([arcCircle(0, 0)], { laserLeads: LEADS })] }, { bed: null }),
    );
    const join = led.polyline.findIndex((point) => point.x === 10 && point.y === 0);
    const before = led.polyline[join - 1] as Vec2;
    const at = led.polyline[join] as Vec2;
    const length = Math.hypot(at.x - before.x, at.y - before.y);
    // Counter-clockwise from (10, 0) the arc heads straight up; the octagon's
    // first chord leans 22.5 degrees off that.
    const angle = Math.acos((at.y - before.y) / length);
    expect(angle).toBeLessThan((5 * Math.PI) / 180);
    expect(validCutArcMoves(led)).not.toBeNull();
  });

  it('measures a neighbour that goes out as arcs by its sweep, not its chords', () => {
    const lines = leadJobLines({ groups: [group([arcCircle(0, 0)])] }).lines;
    const burn = lines[0] ?? [];
    expect(burn.length).toBeGreaterThan(9);
    for (const point of burn)
      expect(Math.abs(Math.hypot(point.x, point.y) - 10)).toBeLessThan(0.003);
  });

  it('still counts an outline cut as thousands of dashes as the container it is', () => {
    const nesting = { forest: 'outline-run', depth: 0, topologyContour: '0' };
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const pieces: CutSegment[] = [];
    for (let side = 0; side < 4; side += 1) {
      const a = corners[side] as Vec2;
      const b = corners[(side + 1) % 4] as Vec2;
      for (let i = 0; i < 750; i += 1) {
        const t0 = i / 750;
        const t1 = (i + 0.75) / 750;
        const piece = [
          { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
          { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
        ];
        // The planner may leave dashes in any order and either way round.
        pieces.push({
          polyline: i % 2 === 0 ? piece : [...piece].reverse(),
          closed: false,
          nesting,
        });
      }
    }
    pieces.reverse();
    const hole = square(40, 40, 20, {
      nesting: { forest: 'hole-run', depth: 0, topologyContour: '0' },
    });
    const started = performance.now();
    const done = applyLaserLeads(
      { groups: [group([hole], { laserLeads: LEADS }), group(pieces)] },
      { bed: null },
    );
    expect(performance.now() - started).toBeLessThan(5000);
    expect(pointInPolygon(first(done).polyline[0] as Vec2, hole.polyline)).toBe(true);
  });
});
