import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { createSegmentBuilder, type SegmentRecord } from '../../core/gcode-view/segment-builder';
import { inspectGcodeText } from './gcode-inspector-parse';
import {
  addPreviewChunk,
  createPreviewEmitter,
  PREVIEW_INTERVAL_MS,
  splitPreview,
  type PreviewChunk,
} from './inspection-preview';

function move(index: number, kind: number): SegmentRecord {
  return {
    x0: index,
    y0: 0,
    z0: 0,
    x1: index + 1,
    y1: 0,
    z1: 0,
    kind,
    motion: 1,
    line: index,
    feed: 600,
    power: 0,
    lengthMm: 1,
  };
}

describe('inspection preview (ADR-485)', () => {
  it('splits a run of moves into solid moves and rapids, in order', () => {
    const builder = createSegmentBuilder();
    builder.push(move(0, SEG_KIND.travel));
    builder.push(move(1, SEG_KIND.cut));
    builder.push(move(2, SEG_KIND.plunge));
    builder.push(move(3, SEG_KIND.travel));
    const split = splitPreview(builder.copyRange(1));
    expect(Array.from(split.solid)).toEqual([1, 0, 0, 2, 0, 0, 2, 0, 0, 3, 0, 0]);
    expect(Array.from(split.travel)).toEqual([3, 0, 0, 4, 0, 0]);
  });

  it('sends only what is new, at most every interval, checking the clock per 1024 lines', () => {
    const builder = createSegmentBuilder();
    const chunks: PreviewChunk[] = [];
    let time = 0;
    const emitter = createPreviewEmitter(
      builder,
      (chunk) => chunks.push(chunk),
      () => time,
    );
    const read = (lines: number): void => {
      for (let line = 0; line < lines; line += 1) {
        builder.push(move(builder.count(), SEG_KIND.cut));
        emitter.line(() => 0.5);
      }
    };
    read(1023);
    time = PREVIEW_INTERVAL_MS * 4;
    read(1);
    expect(chunks.map((chunk) => chunk.moves)).toEqual([1024]);
    expect(chunks[0]?.fraction).toBe(0.5);
    read(1024);
    expect(chunks).toHaveLength(1);
    time += PREVIEW_INTERVAL_MS;
    read(1024);
    expect(chunks.map((chunk) => chunk.solid.length / 6)).toEqual([1024, 2048]);
    emitter.flush();
    expect(chunks).toHaveLength(2);
    read(3);
    emitter.flush();
    expect(chunks.map((chunk) => [chunk.moves, chunk.fraction])).toEqual([
      [1024, 0.5],
      [3072, 0.5],
      [3075, 1],
    ]);
  });

  it('keeps every chunk with the latest count and fraction', () => {
    const first = {
      solid: new Float32Array(6),
      travel: new Float32Array(0),
      moves: 1,
      fraction: 0.2,
    };
    const second = {
      solid: new Float32Array(0),
      travel: new Float32Array(6),
      moves: 2,
      fraction: 0.9,
    };
    const preview = addPreviewChunk(addPreviewChunk(null, first), second);
    expect(preview).toEqual({ chunks: [first, second], moves: 2, fraction: 0.9 });
  });

  it('sends every move of a program before the worker times it', () => {
    const events: string[] = [];
    const chunks: PreviewChunk[] = [];
    const text = `G21 G90\nG0 X5\n${'G1 X10 F600\nG1 X0\n'.repeat(3000)}`;
    const result = inspectGcodeText(
      text,
      {},
      {
        onPreview: (chunk) => {
          events.push('preview');
          chunks.push(chunk);
        },
        onTiming: () => events.push('timing'),
      },
    );
    if (result.parsed.kind !== 'ok') throw new Error('expected a parsed program');
    expect(events.at(-1)).toBe('timing');
    expect(events.filter((event) => event === 'timing')).toHaveLength(1);
    const solid = chunks.reduce((sum, chunk) => sum + chunk.solid.length / 6, 0);
    const travel = chunks.reduce((sum, chunk) => sum + chunk.travel.length / 6, 0);
    expect(solid).toBe(6000);
    expect(travel).toBe(1);
    expect(chunks.at(-1)).toMatchObject({ moves: 6001, fraction: 1 });
    expect(result.parsed.model.segmentCount).toBe(6001);
  });
});
