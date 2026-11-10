import { describe, expect, it } from 'vitest';
import type { SketchArc, SketchCircle, SketchLine } from '../sketch-entity';
import { deferredSnapTargets, onArcSweep } from './deferred-snaps';
import { resolveSnap } from './resolve-snap';
import { alignBounds, alignOnRay, alignToPoints, polarTrack } from './tracking';

function close(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

const circle: SketchCircle = { kind: 'circle', id: 'c', center: { x: 0, y: 0 }, radiusMm: 5 };
const line: SketchLine = { kind: 'line', id: 'l', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };

describe('deferred snaps', () => {
  it('finds both exact tangent points from outside a circle', () => {
    const tangents = deferredSnapTargets([circle], { x: 10, y: 0 }).filter(
      (target) => target.kind === 'tangent',
    );
    expect(tangents).toHaveLength(2);
    for (const { atMm } of tangents) {
      // The radius to a tangent point is perpendicular to the line from the start.
      const radial = { x: atMm.x, y: atMm.y };
      const toStart = { x: 10 - atMm.x, y: -atMm.y };
      expect(radial.x * toStart.x + radial.y * toStart.y).toBeCloseTo(0, 9);
      expect(Math.hypot(atMm.x, atMm.y)).toBeCloseTo(5, 9);
    }
  });

  it('offers no tangent from inside a circle, only the radial points', () => {
    const targets = deferredSnapTargets([circle], { x: 1, y: 0 });
    expect(targets.map((target) => target.kind)).toEqual(['perpendicular', 'perpendicular']);
    close(targets[0]!.atMm, { x: 5, y: 0 });
    close(targets[1]!.atMm, { x: -5, y: 0 });
  });

  it('drops a foot that falls off the end of a segment', () => {
    expect(deferredSnapTargets([line], { x: 40, y: 30 })[0]?.atMm).toEqual({ x: 40, y: 0 });
    expect(deferredSnapTargets([line], { x: 140, y: 30 })).toEqual([]);
  });

  it('keeps an arc target only where the arc is drawn', () => {
    const arc: SketchArc = {
      kind: 'arc',
      id: 'a',
      center: { x: 0, y: 0 },
      radiusMm: 5,
      startAngleDeg: 0,
      sweepDeg: 90,
    };
    expect(onArcSweep(arc, Math.PI / 4)).toBe(true);
    expect(onArcSweep(arc, Math.PI)).toBe(false);
    expect(onArcSweep({ ...arc, startAngleDeg: 90, sweepDeg: -90 }, Math.PI / 4)).toBe(true);
    const radial = deferredSnapTargets([arc], { x: 10, y: 10 }).filter(
      (target) => target.kind === 'perpendicular',
    );
    expect(radial).toHaveLength(1);
  });

  it('is offered by the resolver only once the gesture has a start', () => {
    const query = { sketch: { entities: [line] }, pointMm: { x: 40, y: 0.5 }, toleranceMm: 1 };
    expect(resolveSnap(query)?.target.kind).toBe('on-line');
    const fromAbove = resolveSnap({ ...query, fromMm: { x: 40, y: 30 } });
    expect(fromAbove?.target.kind).toBe('perpendicular');
    expect(fromAbove?.target.atMm).toEqual({ x: 40, y: 0 });
  });

  it('never outranks the endpoint it sits on', () => {
    const query = {
      sketch: { entities: [line] },
      pointMm: { x: 0.2, y: 0 },
      toleranceMm: 1,
      fromMm: { x: 0, y: 30 },
    };
    expect(resolveSnap(query)?.target.kind).toBe('endpoint');
  });
});

describe('polar tracking', () => {
  it('pulls a near-miss onto the nearest step and reports the angle', () => {
    const tracked = polarTrack({ x: 0, y: 0 }, { x: 50, y: 50.6 }, 15, 1);
    expect(tracked?.polarDeg).toBe(45);
    close(tracked!.atMm, { x: 50.3, y: 50.3 });
  });

  it('lets a pointer far off every ray go free, and tracks nothing at the anchor', () => {
    expect(polarTrack({ x: 0, y: 0 }, { x: 50, y: 20 }, 45, 1)).toBeNull();
    expect(polarTrack({ x: 0, y: 0 }, { x: 0.5, y: 0.1 }, 15, 1)).toBeNull();
  });

  it('reports negative angles as their positive turn', () => {
    expect(polarTrack({ x: 0, y: 0 }, { x: 0.2, y: -40 }, 90, 1)?.polarDeg).toBe(270);
  });
});

describe('alignment guides', () => {
  it('aligns each axis to its own nearest reference and draws both guides', () => {
    const aligned = alignToPoints(
      { x: 10.4, y: 30.3 },
      [
        { x: 10, y: 0 },
        { x: 80, y: 30 },
      ],
      1,
    );
    expect(aligned?.atMm).toEqual({ x: 10, y: 30 });
    expect(aligned?.guides).toHaveLength(2);
  });

  it('finds where a polar ray crosses an alignment line', () => {
    const from = { x: 0, y: 0 };
    const polar = polarTrack(from, { x: 20, y: 20.4 }, 45, 1)!;
    const crossed = alignOnRay(
      { ...polar, polarDeg: polar.polarDeg! },
      from,
      { x: 20, y: 20.4 },
      [{ x: 20.5, y: -60 }],
      1,
    );
    close(crossed!.atMm, { x: 20.5, y: 20.5 });
    expect(crossed?.guides).toHaveLength(2);
  });

  it('lines a dragged box up with another object', () => {
    const moving = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const other = { minX: 30, minY: 10.6, maxX: 50, maxY: 30 };
    const aligned = alignBounds(moving, [other], 1);
    expect(aligned?.deltaMm).toEqual({ x: 0, y: expect.closeTo(0.6, 9) });
    expect(aligned?.guides).toHaveLength(1);
    expect(alignBounds(moving, [{ minX: 40, minY: 40, maxX: 50, maxY: 50 }], 1)).toBeNull();
  });
});
