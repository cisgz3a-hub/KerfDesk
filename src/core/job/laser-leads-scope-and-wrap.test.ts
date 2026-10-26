// Laser lead guards from the fourth review (ADR-626): containment judged by the
// whole outline, the one lead-out a one-pass overcut burns, the rotary seam,
// artwork whose leads are off, and perforation on some artwork only.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, DEFAULT_ROTARY_SETUP } from '../devices';
import { pointInPolygon } from '../geometry';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type SceneObject,
  type Vec2,
} from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { compileJob } from './compile-job';
import type { CutGroup, CutSegment, Job } from './job';
import { laserLeadOptions } from './laser-lead-rotary';
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

function closed(points: ReadonlyArray<Vec2>): CutSegment {
  return { polyline: [...points, points[0] as Vec2], closed: true };
}

function square(x: number, y: number, size: number): CutSegment {
  return closed([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]);
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

function segmentOf(job: Job, groupIndex: number): CutSegment {
  const found = job.groups[groupIndex];
  if (found?.kind !== 'cut' || found.segments[0] === undefined) throw new Error('no cut');
  return found.segments[0];
}

function pathLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function artwork(id: string, x: number, override?: ObjectOperationOverride): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
              { x: x + 10, y: 10 },
              { x, y: 10 },
            ],
          },
        ],
      },
    ],
    ...(override === undefined ? {} : { operationIds: ['cut'], operationOverride: override }),
  };
}

function scene(objects: ReadonlyArray<SceneObject>) {
  return {
    layers: [{ ...createLayer({ id: 'cut', color: '#ff0000' }), leadInEnabled: true }],
    objects,
  };
}

describe('laser lead scope and wrap (ADR-626)', () => {
  it('reads a contour that crosses a concave neighbour as an outer contour', () => {
    // A U whose notch the square's top and bottom edges cross: every vertex
    // of the square is inside the U, but the square is not.
    const u = closed([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 25, y: 40 },
      { x: 25, y: 10 },
      { x: 15, y: 10 },
      { x: 15, y: 40 },
      { x: 0, y: 40 },
    ]);
    const crossing = square(12, 20, 16);
    const done = applyLaserLeads(
      { groups: [group([u]), group([crossing], { laserLeads: LEADS })] },
      NO_BED,
    );
    const start = segmentOf(done, 1).polyline[0] as Vec2;
    expect(pointInPolygon(start, crossing.polyline)).toBe(false);
    expect(pointInPolygon(start, u.polyline)).toBe(false);
  });

  it('fits the one lead-out a one-pass overcut burns, whatever is beside the seam', () => {
    // A short cut just clear of where the ordinary seam lead-out would run.
    const beside: CutSegment = {
      polyline: [
        { x: -0.2, y: -1 },
        { x: 0, y: -1 },
      ],
      closed: false,
    };
    const done = applyLaserLeads(
      {
        groups: [
          group([beside]),
          group([square(0, 0, 10)], { laserLeads: LEADS, finalPassOvercutMm: 3 }),
        ],
      },
      NO_BED,
    );
    expect(done.diagnostics).toBeUndefined();
    expect(pathLength(segmentOf(done, 1).polyline)).toBeCloseTo(2 + 40 + 3 + 2, 1);
  });

  it('keeps a lead clear of a cut across the rotary seam', () => {
    // 61 mm round: the strip's top edge is 1 mm from the square, across the seam.
    const job: Job = {
      groups: [
        group([square(0, 0, 10)], { laserLeads: LEADS }),
        group([closed(square(-2, 52, 8).polyline.slice(0, -1))]),
      ],
    };
    const flat = applyLaserLeads(job, NO_BED);
    expect(flat.diagnostics).toBeUndefined();
    const wrapped = applyLaserLeads(job, { bed: null, wrapMm: 61 });
    const led = segmentOf(wrapped, 0);
    const restarted = (led.polyline[0] as Vec2).y > 0;
    expect(restarted || wrapped.diagnostics !== undefined).toBe(true);
    for (const point of led.polyline) {
      const across = { x: point.x, y: point.y + 61 };
      expect(pointInPolygon(across, square(-2, 52, 8).polyline)).toBe(false);
    }
  });

  it('keeps a rotary job, its leads included, within one turn', () => {
    // A 10 mm square on an object 11 mm round: a full 2 mm corner lead would
    // reach 1.27 mm past it, and the job would no longer fit one turn.
    const job: Job = { groups: [group([square(0, 0, 10)], { laserLeads: LEADS })] };
    const span = (done: Job) => {
      const ys = segmentOf(done, 0).polyline.map((point) => point.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const flat = applyLaserLeads(job, NO_BED);
    expect(span(flat)).toBeGreaterThan(11);
    const wrapped = applyLaserLeads(job, { bed: null, wrapMm: 11 });
    expect(span(wrapped)).toBeLessThanOrEqual(11);
    expect(segmentOf(wrapped, 0).closed).toBe(false);
    // Moving the artwork on the flat canvas changes nothing on the rotary.
    const moved = applyLaserLeads(
      { groups: [group([square(0, 140, 10)], { laserLeads: LEADS })] },
      { bed: null, wrapMm: 11 },
    );
    expect(span(moved)).toBeCloseTo(span(wrapped), 9);
  });

  it('wraps leads round the object only on an active rotary', () => {
    const bed = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    expect(laserLeadOptions(DEFAULT_DEVICE_PROFILE, undefined, bed)).toEqual({
      bed,
      wrapMm: null,
      device: DEFAULT_DEVICE_PROFILE,
    });
    const rotary = {
      ...DEFAULT_DEVICE_PROFILE,
      rotary: { ...DEFAULT_ROTARY_SETUP, enabled: true, objectDiameterMm: 50 },
    };
    const options = laserLeadOptions(rotary, undefined, bed);
    expect(options.wrapMm).toBeCloseTo(Math.PI * 50, 9);
    expect(options.bed?.maxY).toBe(Number.POSITIVE_INFINITY);
  });

  it('cuts artwork whose leads are off as one process, whatever lead shape it stores', () => {
    const plain = compileJob(
      {
        ...scene([artwork('a', 0), artwork('b', 20)]),
        layers: [createLayer({ id: 'cut', color: '#ff0000' })],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    const shaped = compileJob(
      {
        layers: [createLayer({ id: 'cut', color: '#ff0000' })],
        objects: [
          artwork('a', 0),
          artwork('b', 20, { byOperation: { cut: { leadStyle: 'line', leadLengthMm: 5 } } }),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(shaped.groups).toEqual(plain.groups);
    const asked = compileJob(
      {
        layers: [createLayer({ id: 'cut', color: '#ff0000' })],
        objects: [
          artwork('a', 0),
          artwork('b', 20, { byOperation: { cut: { leadInEnabled: true } } }),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(asked.groups.filter((g) => g.kind === 'cut')).toHaveLength(2);
  });

  it('records an artwork override that turns off the leads its operation has on', () => {
    const job = compileJob(
      scene([
        artwork('a', 0),
        artwork('b', 20, { byOperation: { cut: { leadInEnabled: false } } }),
      ]),
      DEFAULT_DEVICE_PROFILE,
    );
    const cuts = job.groups.filter((g): g is CutGroup => g.kind === 'cut');
    const plain = cuts.find((g) => g.laserLeads !== undefined);
    const off = cuts.find((g) => g.laserLeads === undefined);
    expect(plain?.operationSettings).toBeUndefined();
    expect(off?.operationSettings).toMatchObject({ leadInEnabled: false });
  });

  it('counts only the perforated artwork as left without leads', () => {
    const job = compileJob(
      scene([
        artwork('a', 0),
        artwork('b', 20, { byOperation: { cut: { perforationEnabled: true } } }),
      ]),
      DEFAULT_DEVICE_PROFILE,
    );
    expect(job.diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'laser-leads-perforated', layerId: 'cut', count: 1 }),
    );
    expect(job.groups.some((g) => g.kind === 'cut' && g.laserLeads !== undefined)).toBe(true);
  });
});
