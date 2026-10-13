import { describe, expect, it, vi } from 'vitest';
import * as containment from './containment-depth';
import type { Vec2 } from '../scene';
import type { CncGroup, CutGroup, CutSegment, Job, RasterGroup } from './job';
import { applyJobStartPoint, jobStartEditingJob, resolveJobStartPoint } from './job-start-point';
import { validCutArcMoves, withCutArcMoves } from './cut-arc-moves';
import { firstToolpathProcessPoint } from './first-process-point';

function square(x = 0, y = 0, size = 10): CutSegment {
  return {
    closed: true,
    polyline: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
      { x, y },
    ],
  };
}

function cut(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'a',
    color: '#000000',
    power: 50,
    speed: 1000,
    passes: 2,
    airAssist: true,
    segments,
  };
}

function length(points: ReadonlyArray<Vec2>): number {
  return points.reduce((sum, point, index) => {
    const previous = points[index - 1];
    return previous === undefined
      ? sum
      : sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

function firstPolyline(job: Job): ReadonlyArray<Vec2> {
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected cut');
  return group.segments[0]?.polyline ?? [];
}

describe('job start selection', () => {
  it('skips contours omitted at output precision, both before and inside the first cutting group', () => {
    const collapsed: CutSegment = {
      closed: false,
      polyline: [
        { x: 10.0001, y: 20 },
        { x: 10.0002, y: 20 },
      ],
    };
    const emptyGroup = cut([collapsed]);
    const vector = cut([collapsed, square(20, 20)]);
    const job: Job = { groups: [emptyGroup, vector] };
    const target = { x: 10, y: 20 };
    expect(resolveJobStartPoint(job, target)).toEqual({
      point: { x: 20, y: 20 },
      supported: true,
    });
    expect(jobStartEditingJob(job)).toEqual({ groups: [vector] });
    const changed = applyJobStartPoint(job, target);
    expect(changed.groups[0]).toBe(emptyGroup);
    const selected = changed.groups[1];
    expect(selected?.kind === 'cut' && selected.segments[0]?.polyline[0]).toEqual({ x: 20, y: 20 });
    expect(resolveJobStartPoint({ groups: [emptyGroup] }, target)).toBeNull();
  });

  it('does not let a collapsed inner contour exclude every real contour with inside-first enabled', () => {
    const job: Job = { groups: [cut([square(), square(5.0001, 5.0001, 0.0001)])] };
    expect(resolveJobStartPoint(job, { x: 5, y: 5 }, { insideFirst: true })).toEqual({
      point: { x: 5, y: 0 },
      supported: true,
    });
  });

  it.each(['buffered', 'streamed'] as const)(
    'skips an empty %s raster before the first vector cut',
    (storage) => {
      const rows = vi.fn(() => new Uint16Array([0, 0]));
      const raster: RasterGroup = {
        ...cut([]),
        kind: 'raster',
        pixelWidth: 2,
        pixelHeight: 2,
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
        sValues: new Uint16Array(storage === 'buffered' ? 4 : 0),
        overscanMm: 1,
        dotWidthCorrectionMm: 0,
        ...(storage === 'streamed' ? { rowProvider: rows } : {}),
      };
      const vector = cut([square(20)]);
      const job: Job = { groups: [raster, vector] };
      const target = { x: 25, y: 0 };
      expect(resolveJobStartPoint(job, target)).toEqual({ point: target, supported: true });
      expect(jobStartEditingJob(job)).toEqual({ groups: [vector] });
      const changed = applyJobStartPoint(job, target);
      expect(changed.groups[0]).toBe(raster);
      const selected = changed.groups[1];
      expect(selected?.kind === 'cut' && selected.segments[0]?.polyline[0]).toEqual(target);
      if (storage === 'streamed') expect(rows).toHaveBeenCalledTimes(2);
    },
  );

  it('retains a raster with actual burn before a later vector operation', () => {
    const raster: RasterGroup = {
      ...cut([]),
      kind: 'raster',
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      sValues: new Uint16Array([0, 0, 0, 500]),
      overscanMm: 1,
      dotWidthCorrectionMm: 0,
    };
    const job: Job = { groups: [raster, cut([square(20)])] };
    expect(resolveJobStartPoint(job, { x: 25, y: 0 })?.supported).toBe(false);
    expect(jobStartEditingJob(job)).toEqual({ groups: [] });
    expect(applyJobStartPoint(job, { x: 25, y: 0 })).toBe(job);
  });

  it('keeps native arc geometry and only snaps to valid native move boundaries', () => {
    const points = [
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
      { x: 0, y: -10 },
      { x: 10, y: 0 },
    ];
    const segment: CutSegment = withCutArcMoves({ closed: true, polyline: points }, [
      { kind: 'arc', center: { x: 0, y: 0 }, to: { x: 0, y: 10 }, clockwise: false },
      { kind: 'arc', center: { x: 0, y: 0 }, to: { x: -10, y: 0 }, clockwise: false },
      { kind: 'arc', center: { x: 0, y: 0 }, to: { x: 0, y: -10 }, clockwise: false },
      { kind: 'arc', center: { x: 0, y: 0 }, to: { x: 10, y: 0 }, clockwise: false },
    ]);
    expect(validCutArcMoves(segment)).not.toBeNull();
    const changed = applyJobStartPoint({ groups: [cut([segment])] }, { x: -9, y: 2 });
    const group = changed.groups[0];
    if (group?.kind !== 'cut' || group.segments[0] === undefined) throw new Error('cut missing');
    expect(group.segments[0].polyline[0]).toEqual({ x: -10, y: 0 });
    expect(validCutArcMoves(group.segments[0])).toEqual([
      segment.arcMoves?.moves[2],
      segment.arcMoves?.moves[3],
      segment.arcMoves?.moves[0],
      segment.arcMoves?.moves[1],
    ]);
  });

  it('retains only the first supported burning group in the worker editing payload', () => {
    const off = { ...cut([square()]), power: 0 };
    const first = cut([square(20)]);
    const later = cut([square(40)]);
    expect(jobStartEditingJob({ groups: [off, first, later] })).toEqual({ groups: [first] });
    expect(resolveJobStartPoint({ groups: [off, first] }, { x: 25, y: 0 })?.point).toEqual({
      x: 25,
      y: 0,
    });
  });

  it('reuses containment during dragging but recomputes it for changed geometry', () => {
    const spy = vi.spyOn(containment, 'containmentDepths');
    try {
      const input = { groups: [cut([square(0, 0, 30), square(10, 10, 5)])] };
      const options = { insideFirst: true };
      expect(resolveJobStartPoint(input, { x: 11, y: 0 }, options)?.point).toEqual({
        x: 11,
        y: 10,
      });
      expect(resolveJobStartPoint(input, { x: 14, y: 0 }, options)?.point).toEqual({
        x: 14,
        y: 10,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const changed = { groups: [cut([square(0, 0, 30), square(20, 20, 5)])] };
      expect(resolveJobStartPoint(changed, { x: 21, y: 0 }, options)?.point).toEqual({
        x: 21,
        y: 20,
      });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('projects a closed start onto an edge without changing geometry, direction, or settings', () => {
    const group = cut([square()]);
    const input = { groups: [group] };
    const changed = applyJobStartPoint(input, { x: 7, y: -2 });
    expect(firstPolyline(changed)).toEqual([
      { x: 7, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 7, y: 0 },
    ]);
    expect(length(firstPolyline(changed))).toBe(40);
    expect(changed.groups[0]).toMatchObject({ power: 50, passes: 2, airAssist: true });
    expect(firstPolyline(input)[0]).toEqual({ x: 0, y: 0 });
  });

  it.each([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ])('does not duplicate a selected existing corner %j', (point) => {
    const points = firstPolyline(applyJobStartPoint({ groups: [cut([square()])] }, point));
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual(point);
    expect(points[4]).toEqual(point);
    expect(length(points)).toBe(40);
  });

  it('selects another contour within the first group without moving a later operation', () => {
    const later = cut([square(100)]);
    const input = { groups: [cut([square(), square(30)]), later] };
    const changed = applyJobStartPoint(input, { x: 35, y: 0 });
    expect(firstPolyline(changed)[0]).toEqual({ x: 35, y: 0 });
    expect(changed.groups[1]).toBe(later);
    expect(resolveJobStartPoint(input, { x: 105, y: 0 })?.point).toEqual({ x: 40, y: 0 });
  });

  it('preserves inside-first dependencies when the target is on an enclosing contour', () => {
    const input = { groups: [cut([square(0, 0, 30), square(10, 10, 5)])] };
    expect(resolveJobStartPoint(input, { x: 0, y: 0 }, { insideFirst: true })?.point).toEqual({
      x: 10,
      y: 10,
    });
    expect(resolveJobStartPoint(input, { x: 0, y: 0 }, { insideFirst: false })?.point).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('only offers valid endpoints for open cuts and honours preserved direction', () => {
    const input = {
      groups: [
        cut([
          {
            closed: false,
            polyline: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        ]),
      ],
    };
    expect(firstPolyline(applyJobStartPoint(input, { x: 9, y: 3 }))).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(resolveJobStartPoint(input, { x: 9, y: 3 }, { allowReverse: false })?.point).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('does not cross a fill operation to reach a later cut', () => {
    const input: Job = {
      groups: [
        {
          ...cut([square()]),
          kind: 'fill',
          overscanMm: 2,
          segments: [{ ...square(), reverse: false }],
        },
        cut([square(30)]),
      ],
    };
    expect(resolveJobStartPoint(input, { x: 35, y: 0 })?.supported).toBe(false);
    expect(applyJobStartPoint(input, { x: 35, y: 0 })).toBe(input);
  });

  it('ignores invalid stored targets', () => {
    const input = { groups: [cut([square()])] };
    expect(applyJobStartPoint(input, { x: Number.NaN, y: 0 })).toBe(input);
  });
});

function cnc(): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'a',
    color: '#000000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3,
    feedMmPerMin: 1000,
    plungeMmPerMin: 100,
    spindleRpm: 10000,
    spindleSpinupSec: 1,
    safeZMm: 5,
    passes: [-1, -2, -3].map((zMm) => ({ kind: 'contour', zMm, ...square() })),
  };
}

describe('CNC start selection', () => {
  it('skips a CNC contour with no controller-representable motion before selecting a later group', () => {
    const collapsed: CncGroup = {
      ...cnc(),
      passes: [
        {
          kind: 'contour',
          zMm: -1,
          closed: false,
          polyline: [
            { x: 247.01767, y: 20 },
            { x: 247.01768, y: 20 },
          ],
        },
      ],
    };
    expect(firstToolpathProcessPoint({ groups: [collapsed] })).toBeNull();
    expect(resolveJobStartPoint({ groups: [collapsed] }, { x: 4, y: 0 })).toBeNull();
    const real = cnc();
    const input: Job = { groups: [collapsed, real] };
    expect(jobStartEditingJob(input)).toEqual({ groups: [real] });
    expect(resolveJobStartPoint(input, { x: 4, y: 0 })).toEqual({
      point: { x: 4, y: 0 },
      supported: true,
    });
    const changed = applyJobStartPoint(input, { x: 4, y: 0 });
    expect(changed.groups[0]).toBe(collapsed);
    expect(firstToolpathProcessPoint(changed)).toEqual({ x: 4, y: 0 });
    const selected = changed.groups[1];
    if (selected?.kind !== 'cnc') throw new Error('expected cnc');
    expect(selected.passes.map((pass) => pass.kind === 'contour' && pass.polyline[0])).toEqual([
      { x: 4, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('rotates matching depth passes together without changing depths or direction', () => {
    const changed = applyJobStartPoint({ groups: [cnc()] }, { x: 4, y: 0 });
    const group = changed.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected cnc');
    expect(
      group.passes.map((pass) =>
        pass.kind === 'contour' ? [pass.zMm, pass.polyline[0], length(pass.polyline)] : null,
      ),
    ).toEqual([-1, -2, -3].map((z) => [z, { x: 4, y: 0 }, 40]));
  });

  it('leaves tabs and ramp entry paths intact', () => {
    const group = cnc();
    const input: Job = {
      groups: [
        {
          ...group,
          passes: [
            {
              kind: 'path3d',
              closed: false,
              points: [
                { x: 0, y: 0, z: 0 },
                { x: 10, y: 0, z: -1 },
              ],
              entryRamp: true,
            },
            ...group.passes,
          ],
        },
      ],
    };
    expect(resolveJobStartPoint(input, { x: 4, y: 0 })?.supported).toBe(false);
    expect(applyJobStartPoint(input, { x: 4, y: 0 })).toBe(input);
  });
});
