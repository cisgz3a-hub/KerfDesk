// ADR-250 Amendment 4 (rolling audit v3 G5-P1-1): an On path cut follows each
// stacked copy of an outline, so its kept walls count the copy once. Filled
// even-odd, two copies cancelled and the part had no wall at all.

import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { profileLeadKeptWalls } from './profile-lead-kept-walls';

const CUT_WIDTH_MM = 3.175;

function rect(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

const PART = rect(10, 10, 20, 10);
const HOLE = rect(15, 13, 5, 4);

function reversed(ring: Polyline): Polyline {
  const points = [...ring.points].reverse();
  return { closed: true, points: [...points.slice(1), ...points.slice(0, 1)] };
}

function onPath(contours: ReadonlyArray<Polyline>) {
  return profileLeadKeptWalls(contours, 'profile-on-path', CUT_WIDTH_MM);
}

describe('On path kept walls with stacked copies', () => {
  it('keeps one wall for two, three, reversed and sub-0.001 mm copies', () => {
    const one = onPath([PART]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ keptInside: true, clearedMm: CUT_WIDTH_MM / 2 });
    // Off by less than the 0.001 mm grid the offset and the emitter round to.
    const jittered: Polyline = {
      closed: true,
      points: PART.points.map((point) => ({ x: point.x + 0.0001, y: point.y - 0.0002 })),
    };
    const copies: ReadonlyArray<ReadonlyArray<Polyline>> = [
      [PART, PART],
      [PART, PART, PART],
      [PART, reversed(PART)],
      [PART, jittered],
    ];
    for (const contours of copies) expect(onPath(contours)).toEqual(one);
  });

  it('keeps a part’s hole and collapses only exact copies', () => {
    const single = onPath([PART, HOLE]);
    expect(single.map((wall) => wall.keptInside).sort()).toEqual([false, true]);
    expect(onPath([PART, HOLE, reversed(HOLE), PART])).toEqual(single);
  });

  it('leaves a filled cut’s contours as its kerf offset reads them', () => {
    // Outside and Inside paths merge copies as they are collected (ADR-359
    // Amendment 3); a pair that reaches the offset unmerged cuts nothing.
    expect(profileLeadKeptWalls([PART, PART], 'profile-outside', CUT_WIDTH_MM)).toEqual([]);
  });
});
