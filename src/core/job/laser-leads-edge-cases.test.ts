// Laser lead edge cases from review (ADR-626): an outline cut twice, an arc
// lead whose sweep bulges past its samples at the bed edge, and a final-pass
// burn through the rotary mapping and the Ruida encoder.

import { describe, expect, it } from 'vitest';
import { encodeRdJob } from '../controllers/ruida/rd-encoder';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { finalPassCutSegments } from './cut-pass-segments';
import type { CutGroup, CutSegment, Job } from './job';
import { leadPath } from './laser-lead-path';
import type { CutGroupLaserLeads } from './laser-lead-settings';
import { applyRotaryYScale } from './rotary-transform';

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

function firstSegment(job: Job): CutSegment {
  const cut = job.groups[0];
  const segment = cut?.kind === 'cut' ? cut.segments[0] : undefined;
  if (segment === undefined) throw new Error('expected a segment');
  return segment;
}

describe('laser lead edge cases (ADR-626)', () => {
  it('counts an outline cut by two operations once, so its hole still leads inside', () => {
    const hole = square(10, 10, 20);
    const done = applyLaserLeads(
      {
        groups: [
          group([hole], { laserLeads: LEADS }),
          group([square(0, 0, 40)]),
          group([square(0, 0, 40)]),
        ],
      },
      { bed: null },
    );
    expect(pointInPolygon(firstSegment(done).polyline[0] as Vec2, hole.polyline)).toBe(true);
  });

  it('keeps an arc lead on the bed by its full sweep, not just its sampled points', () => {
    // A half-turn lead-in reaches its leftmost point mid-sweep, between samples.
    const join = { at: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, scrap: { x: 0, y: -1 } };
    const shape = { style: 'arc' as const, lengthMm: 2, angleDeg: 180 };
    const path = leadPath('in', join, shape);
    const sampledMinX = Math.min(...path.points.map((point) => point.x));
    const sweptMinX = -shape.lengthMm / Math.PI;
    const edge = (sampledMinX + sweptMinX) / 2;
    expect(sweptMinX).toBeLessThan(edge);
    expect(sampledMinX).toBeGreaterThan(edge);
    const bed = { minX: edge, minY: -50, maxX: 300, maxY: 300 };
    const done = applyLaserLeads(
      {
        groups: [
          group([square(0, 0, 10)], { laserLeads: { ...LEADS, angleDeg: 180, leadOut: false } }),
        ],
      },
      { bed },
    );
    for (const point of firstSegment(done).polyline) expect(point.x).toBeGreaterThan(edge);
    expect(done.diagnostics).toEqual([
      { kind: 'laser-leads-adjusted', layerId: 'L', layerName: 'Cut', shortened: 1, omitted: 0 },
    ]);
  });

  it('maps the final-pass burn through the rotary, and counts it in the Y range', () => {
    const job: Job = {
      groups: [
        group(
          [
            {
              polyline: [
                { x: 0, y: 10 },
                { x: 0, y: 20 },
              ],
              closed: false,
              finalPassBurn: {
                polyline: [
                  { x: 0, y: 10 },
                  { x: 0, y: 20 },
                  { x: -1, y: 8 },
                ],
              },
            },
          ],
          { passes: 2, finalPassOvercutMm: 1 },
        ),
      ],
    };
    const rotary = applyRotaryYScale(job, 2);
    const cut = rotary.groups[0];
    if (cut?.kind !== 'cut') throw new Error('expected a cut group');
    expect(cut.segments[0]?.polyline).toEqual([
      { x: 0, y: 4 },
      { x: 0, y: 24 },
    ]);
    expect(finalPassCutSegments(cut)[0]?.polyline).toEqual([
      { x: 0, y: 4 },
      { x: 0, y: 24 },
      { x: -1, y: 0 },
    ]);
  });

  it('refuses a Ruida export whose final-pass burn leaves the encodable range', () => {
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
                  { x: 10, y: 0 },
                  { x: 1e9, y: 0 },
                ],
              },
            },
          ],
          { passes: 2, finalPassOvercutMm: 1 },
        ),
      ],
    };
    const encoded = encodeRdJob(job, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' });
    expect(encoded.ok).toBe(false);
    if (encoded.ok) return;
    expect(encoded.error).toMatchObject({
      kind: 'coordinate-out-of-range',
      path: 'layer(L).segments[0].finalPassBurn.polyline[2].x',
    });
  });
});
