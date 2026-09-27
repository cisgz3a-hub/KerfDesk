import { describe, expect, it } from 'vitest';
import { createSegmentBuilder, type SegmentRecord } from './segment-builder';

function record(index: number): SegmentRecord {
  return {
    x0: index,
    y0: index + 0.25,
    z0: -index,
    x1: index + 1,
    y1: index + 1.25,
    z1: -index - 1,
    kind: index % 4,
    motion: index % 2,
    line: index * 3,
    feed: 100 + index,
    power: index % 7,
    lengthMm: 0.5,
  };
}

function built(count: number, retain: boolean, chunkMoves: number) {
  const builder = createSegmentBuilder(retain, chunkMoves);
  for (let index = 0; index < count; index += 1) builder.push(record(index));
  return builder;
}

describe('createSegmentBuilder (ADR-485 chunks)', () => {
  it('finishes exact arrays holding every move across chunk boundaries', () => {
    const finished = built(10, true, 3).finish();
    expect(finished.segmentCount).toBe(10);
    expect(finished.positions).toHaveLength(60);
    expect(Array.from(finished.positions.subarray(42, 48))).toEqual([7, 7.25, -7, 8, 8.25, -8]);
    expect(Array.from(finished.segKind)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    expect(finished.segLine[9]).toBe(27);
    expect(finished.segFeed[4]).toBe(104);
    expect(finished.segRouteEndMm[9]).toBe(5);
    expect(finished.segLengthMm).toHaveLength(10);
    expect(finished.totalRouteMm).toBe(5);
    for (const array of [finished.positions, finished.segKind, finished.segLine]) {
      expect(array.byteOffset).toBe(0);
      expect(array.buffer.byteLength).toBe(array.byteLength);
    }
  });

  it('leaves precise lengths out unless asked, and finishes once', () => {
    const builder = built(5, false, 2);
    const finished = builder.finish();
    expect(finished.segLengthMm).toBeUndefined();
    expect(builder.finish()).toBe(finished);
  });

  it('copies any run of moves read so far, across chunks', () => {
    const builder = built(7, false, 3);
    const run = builder.copyRange(2);
    expect(Array.from(run.segKind)).toEqual([2, 3, 0, 1, 2]);
    expect(run.positions).toHaveLength(30);
    expect(run.positions[0]).toBe(2);
    expect(run.positions[24]).toBe(6);
    expect(builder.copyRange(7).positions).toHaveLength(0);
    builder.push(record(7));
    expect(Array.from(builder.copyRange(7).segKind)).toEqual([3]);
  });

  it('keeps a short program in a small first chunk', () => {
    const builder = createSegmentBuilder();
    builder.push(record(0));
    expect(builder.finish().positions).toHaveLength(6);
  });

  it('builds an empty program', () => {
    const finished = createSegmentBuilder(true).finish();
    expect(finished.segmentCount).toBe(0);
    expect(finished.positions).toHaveLength(0);
    expect(finished.segLengthMm).toHaveLength(0);
  });
});
