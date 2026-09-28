import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { buildMoveDetail, DETAIL_MIN_MOVES, type MoveDetailInput } from './move-detail';

const MOVES = DETAIL_MIN_MOVES;
const STEP = 0.01;

// A straight cut along X, one move a step, every move joined to the next.
function straightCut(count = MOVES, point = (index: number) => [index * STEP, 0, -1]) {
  const positions = new Float32Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    positions.set(point(index), index * 6);
    positions.set(point(index + 1), index * 6 + 3);
  }
  return {
    segmentCount: count,
    positions,
    segKind: new Uint8Array(count).fill(SEG_KIND.cut),
    segFeed: new Float32Array(count).fill(600),
    segPower: new Float32Array(count).fill(1000),
    segLine: new Uint32Array(count).map((_, index) => index + 1),
    diagonalMm: count * STEP,
  } satisfies MoveDetailInput;
}

function covered(detail: ReturnType<typeof buildMoveDetail>, level = 0): number[][] {
  const drawn = detail?.levels[level];
  if (drawn === undefined) throw new Error('no level');
  return Array.from(drawn.starts, (start, line) => [start, drawn.ends[line] ?? -1]);
}

describe('move detail levels (ADR-485)', () => {
  it('leaves programs under the size alone', () => {
    expect(buildMoveDetail(straightCut(MOVES - 1))).toBeNull();
    expect(buildMoveDetail({ ...straightCut(), diagonalMm: 0 })).toBeNull();
  });

  it('draws a straight cut as one line per 64 moves, keeping one level when both agree', () => {
    const detail = buildMoveDetail(straightCut());
    expect(detail?.solidMoves).toBe(MOVES);
    expect(detail?.levels).toHaveLength(1);
    const lines = covered(detail);
    expect(lines).toHaveLength(Math.ceil(MOVES / 64));
    expect(lines[0]).toEqual([0, 63]);
    expect(lines[1]).toEqual([64, 127]);
    expect(lines.at(-1)?.[1]).toBe(MOVES - 1);
  });

  it('breaks a run where power, feed, reached feed or kind change, or at a tool change', () => {
    const input = straightCut();
    input.segPower[10] = 500;
    input.segFeed[20] = 900;
    input.segKind[30] = SEG_KIND.plunge;
    const feedLimited = new Uint8Array(MOVES);
    feedLimited[40] = 1;
    const lines = covered(buildMoveDetail({ ...input, feedLimited, toolLines: [51] }));
    const breaks = lines.slice(0, 10).map(([start]) => start);
    expect(breaks).toEqual([0, 10, 11, 20, 21, 30, 31, 40, 41, 50]);
  });

  it('breaks a run at a rapid or a gap between moves, and draws no rapid', () => {
    const input = straightCut(MOVES + 1);
    input.segKind[5] = SEG_KIND.travel;
    // From move 12 on, the cut carries on 1 mm over: a gap between moves 11 and 12.
    for (let at = 12 * 6 + 1; at < input.positions.length; at += 3) {
      input.positions[at] = (input.positions[at] ?? 0) + 1;
    }
    const lines = covered(buildMoveDetail(input));
    expect(lines.slice(0, 3)).toEqual([
      [0, 4],
      [6, 11],
      [12, 75],
    ]);
  });

  it('keeps every move within its tolerance of the line drawn for it', () => {
    // A zigzag 0.05 mm high: inside the coarse tolerance, outside the fine one.
    const zigzag = (index: number) => [index * STEP, index % 2 === 0 ? 0 : 0.05, -1];
    const input = { ...straightCut(MOVES, zigzag), diagonalMm: 200 };
    const detail = buildMoveDetail(input);
    const [coarse, fine] = detail?.levels ?? [];
    expect(coarse?.toleranceMm).toBeCloseTo(0.1);
    expect(fine).toBeUndefined();
    expect(coarse?.starts.length).toBeLessThan(MOVES / 60);
    const tight = buildMoveDetail({ ...input, diagonalMm: 20 });
    expect(tight).toBeNull();
  });
});
