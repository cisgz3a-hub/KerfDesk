// Laser lead guards from the fourth review (ADR-626): another cut right beside
// the join, broken outlines read whole from compile, final-pass coordinates
// and a short overcut's own heading.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { finalPassCutSegments } from './cut-pass-segments';
import { gcodeCoordinateFailure } from './job-coordinate-encodability';
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

function square(x: number, y: number, size: number): CutSegment {
  const ring = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  return { polyline: [...ring, ring[0] as Vec2], closed: true };
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

function first(job: Job): CutSegment {
  const cut = job.groups[0];
  const segment = cut?.kind === 'cut' ? cut.segments[0] : undefined;
  if (segment === undefined) throw new Error('expected a segment');
  return segment;
}

describe('laser lead review guards (ADR-626)', () => {
  it('checks another cut right beside the join from the first step', () => {
    // An open cut 0.05 mm left of the square's corner start: a 0.1 mm lead
    // there would burn into it.
    const cut: CutSegment = {
      polyline: [
        { x: -0.05, y: -1 },
        { x: -0.05, y: 1 },
      ],
      closed: false,
    };
    const led = first(
      applyLaserLeads(
        { groups: [group([square(0, 0, 10), cut], { laserLeads: { ...LEADS, lengthMm: 0.1 } })] },
        { bed: null },
      ),
    );
    const start = led.polyline[0] as Vec2;
    expect(Math.hypot(start.x, start.y)).toBeGreaterThan(1);
  });

  it('reads a broken outline whole from compile instead of rebuilding it from its pieces', () => {
    // A 0.2 mm strip cut in pieces whose gaps are wider than the strip: the
    // pieces alone could be chained across the strip.
    const nesting = { forest: 'strip', depth: 0, topologyContour: '0' };
    const outline = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0.2 },
      { x: 0, y: 0.2 },
      { x: 0, y: 0 },
    ];
    const pieces: CutSegment[] = [
      {
        polyline: [
          { x: 1, y: 0 },
          { x: 49, y: 0 },
        ],
        closed: false,
        nesting,
      },
      {
        polyline: [
          { x: 49, y: 0.2 },
          { x: 1, y: 0.2 },
        ],
        closed: false,
        nesting,
      },
    ];
    const lines = leadJobLines({
      groups: [
        group(pieces, { topologyRings: [{ forest: 'strip', contour: '0', polyline: outline }] }),
      ],
    });
    expect(lines.rings[0]?.points).toBe(outline);
  });

  it('drops the broken outlines from the prepared job', () => {
    const job: Job = {
      groups: [
        group([square(0, 0, 10)], { topologyRings: [{ forest: 'f', contour: '0', polyline: [] }] }),
      ],
    };
    expect(applyLaserLeads(job, { bed: null }).groups[0]).not.toHaveProperty('topologyRings');
  });

  it('refuses G-code whose final-pass burn cannot be written, even when every other point can', () => {
    const job: Job = {
      groups: [
        group(
          [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              closed: false,
              finalPassBurn: {
                polyline: [
                  { x: 0, y: 0 },
                  { x: 1e300, y: 0 },
                ],
              },
            },
          ],
          { passes: 2, finalPassOvercutMm: 1 },
        ),
      ],
    };
    expect(gcodeCoordinateFailure(job)?.path).toContain('finalPassBurn');
  });

  it('leaves a very short overcut along its own edge', () => {
    const done = applyLaserLeads(
      {
        groups: [
          group([square(0, 0, 10)], { laserLeads: LEADS, passes: 2, finalPassOvercutMm: 0.01 }),
        ],
      },
      { bed: null },
    );
    const cut = done.groups[0];
    if (cut?.kind !== 'cut') throw new Error('expected a cut group');
    const final = finalPassCutSegments(cut)[0]?.polyline ?? [];
    const end = final.findIndex((point) => point.x === 0.01 && point.y === 0);
    const from = final[end] as Vec2;
    const next = final[end + 1] as Vec2;
    // The overcut heads +X along the bottom edge; the lead-out leaves the same way.
    const heading = Math.atan2(next.y - from.y, next.x - from.x);
    expect(Math.abs(heading)).toBeLessThan((15 * Math.PI) / 180);
  });

  it('keeps a lead clear of a lead another contour placed before it', () => {
    // Two squares 3.5 mm apart, started on their facing edges, with 2 mm
    // straight leads aimed at each other across the gap.
    const a: CutSegment = {
      polyline: [
        { x: 10, y: 5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
      closed: true,
    };
    const b: CutSegment = {
      polyline: [
        { x: 13.5, y: 5 },
        { x: 13.5, y: 0 },
        { x: 23.5, y: 0 },
        { x: 23.5, y: 10 },
        { x: 13.5, y: 10 },
        { x: 13.5, y: 5 },
      ],
      closed: true,
    };
    const leads = { ...LEADS, style: 'line' as const, angleDeg: 90, leadOut: false };
    const done = applyLaserLeads({ groups: [group([a, b], { laserLeads: leads })] }, { bed: null });
    const cut = done.groups[0];
    if (cut?.kind !== 'cut') throw new Error('expected a cut group');
    const leadA = cut.segments[0]?.polyline.slice(0, 2) ?? [];
    const leadB = cut.segments[1]?.polyline.slice(0, 2) ?? [];
    expect(leadA[0]).toEqual({ x: 12, y: 5 });
    // Each end of B's lead stays at least the clearance from A's lead.
    const gap = Math.min(...leadB.map((point) => Math.abs(point.x - 12)));
    expect((leadB[0] as Vec2).x).toBeGreaterThan(12);
    expect(gap).toBeGreaterThanOrEqual(0.2);
    expect(done.diagnostics).toEqual([
      { kind: 'laser-leads-adjusted', layerId: 'L', layerName: 'Cut', shortened: 1, omitted: 0 },
    ]);
  });
});
