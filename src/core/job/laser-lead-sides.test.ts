import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import type { CutGroup, CutSegment } from './job';
import { leadJobLines } from './laser-lead-rings';
import { leadSideVerdicts, type LeadSideContour } from './laser-lead-sides';

function square(x: number, y: number, size: number): Vec2[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ];
}

function contour(
  key: string,
  points: ReadonlyArray<Vec2>,
  decides = true,
  operationName = 'Cut',
): LeadSideContour {
  return { key, points, decides, operationName };
}

function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#000000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
  };
}

describe('laser lead scrap sides (ADR-626 Amd 1)', () => {
  it('reads parity among the contours of operations with leads', () => {
    const verdicts = leadSideVerdicts([
      contour('plate', square(0, 0, 40)),
      contour('hole', square(10, 10, 20)),
      contour('island', square(15, 15, 10)),
    ]);
    expect(verdicts.get('plate')?.side).toBe('outside');
    expect(verdicts.get('hole')?.side).toBe('inside');
    expect(verdicts.get('island')?.side).toBe('outside');
  });

  it('leaves the side unknown inside a closed shape on an operation without leads', () => {
    const verdicts = leadSideVerdicts([
      contour('border', square(-10, -10, 60), false, 'Border'),
      contour('plate', square(0, 0, 40)),
    ]);
    expect(verdicts.get('plate')).toMatchObject({ side: 'unknown', aroundName: 'Border' });
    expect(verdicts.get('border')?.side).toBe('outside');
  });

  it('counts one contour on two operations, or drawn twice, once', () => {
    const verdicts = leadSideVerdicts([
      contour('plate', square(0, 0, 40), false, 'Score'),
      contour('plate', square(0, 0, 40)),
      contour('again', square(0, 0, 40), false, 'Score'),
      contour('hole', square(10, 10, 20)),
    ]);
    expect(verdicts.get('hole')?.side).toBe('inside');
    expect(verdicts.get('again')?.copyClass).toBe(verdicts.get('plate')?.copyClass);
  });

  it('keeps two whole cuts of a contour copies when a third operation splits it', () => {
    const scene = [contour('bar', square(0, 0, 30))];
    const whole: CutSegment = { polyline: square(0, 0, 30), closed: true, leadSource: 'bar' };
    const left: CutSegment = { polyline: square(1, 1, 10), closed: true, leadSource: 'bar' };
    const right: CutSegment = { polyline: square(19, 1, 10), closed: true, leadSource: 'bar' };
    const lines = leadJobLines(
      { groups: [group([whole]), group([{ ...whole }]), group([left, right])] },
      undefined,
      scene,
    );
    expect(lines.copies[0]).toEqual([1]);
    expect(lines.copies[1]).toEqual([0]);
    expect(lines.copies[2]).toEqual([]);
    expect([...(lines.exempt[2] ?? [])].sort()).toEqual([0, 1]);
  });

  it('exempts each kerf piece from the outline it was split from, but copies only its duplicate', () => {
    const scene = [contour('bar', square(0, 0, 30))];
    const whole: CutSegment = { polyline: square(0, 0, 30), closed: true, leadSource: 'bar' };
    const left: CutSegment = { polyline: square(1, 1, 10), closed: true, leadSource: 'bar' };
    const right: CutSegment = { polyline: square(19, 1, 10), closed: true, leadSource: 'bar' };
    const lines = leadJobLines(
      { groups: [group([whole]), group([left, right, { ...left }])] },
      undefined,
      scene,
    );
    // The whole outline is no copy of a piece of it, but each piece may cross
    // it (and the whole outline every piece); the pieces of one group stay apart.
    expect(lines.copies[0]).toEqual([]);
    expect(lines.copies[1]).toEqual([3]);
    expect(lines.copies[2]).toEqual([]);
    expect([...(lines.exempt[0] ?? [])].sort()).toEqual([1, 2, 3]);
    expect([...(lines.exempt[1] ?? [])].sort()).toEqual([0, 3]);
    expect(lines.exempt[2]).toEqual([0]);
    expect(lines.sides.every((side) => side.side === 'outside')).toBe(true);
  });
});
