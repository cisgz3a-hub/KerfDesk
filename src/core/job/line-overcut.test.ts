import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { encodeRdJob } from '../controllers/ruida/rd-encoder';
import { cutAbsolute } from '../controllers/ruida/rd-commands';
import { unswizzleByte } from '../controllers/ruida/swizzle';
import { grblStrategy } from '../output/grbl-strategy';
import { applyAutomaticTabsToPolylines } from '../geometry/tabs-bridges';
import type { CutGroup, CutSegment, Job } from './job';
import { finalPassSegment, lineOvercutMm, MAX_LINE_OVERCUT_MM, overcutTail } from './line-overcut';
import { buildToolpath } from './toolpath';

const SQUARE: CutSegment = {
  polyline: [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 10 },
  ],
  closed: true,
};

function cutJob(segments: ReadonlyArray<CutSegment>, patch: Partial<CutGroup> = {}): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 50,
        speed: 1000,
        passes: 2,
        airAssist: false,
        segments,
        ...patch,
      },
    ],
  };
}

function burnLines(gcode: string): string[] {
  return gcode.split('\n').filter((line) => /^G1 X/.test(line) && !/S0\b/.test(line));
}

describe('lineOvercutMm', () => {
  it('applies to Line operations with a positive finite length only', () => {
    expect(lineOvercutMm({ mode: 'line' })).toBeUndefined();
    expect(lineOvercutMm({ mode: 'line', overcutMm: 0 })).toBeUndefined();
    expect(lineOvercutMm({ mode: 'line', overcutMm: -1 })).toBeUndefined();
    expect(lineOvercutMm({ mode: 'line', overcutMm: Number.NaN })).toBeUndefined();
    expect(lineOvercutMm({ mode: 'fill', overcutMm: 2 })).toBeUndefined();
    expect(lineOvercutMm({ mode: 'line', overcutMm: 2 })).toBe(2);
    expect(lineOvercutMm({ mode: 'line', overcutMm: 500 })).toBe(MAX_LINE_OVERCUT_MM);
  });
});

describe('overcut geometry', () => {
  it('retraces the loop from its start in the cut direction', () => {
    expect(overcutTail(SQUARE.polyline, 4)).toEqual([{ x: 14, y: 10 }]);
    expect(overcutTail(SQUARE.polyline, 15)).toEqual([
      { x: 20, y: 10 },
      { x: 20, y: 15 },
    ]);
  });

  it('never goes round more than once', () => {
    expect(overcutTail(SQUARE.polyline, 999)).toEqual(SQUARE.polyline.slice(1));
  });

  it('extends closed segments only and keeps everything else identical', () => {
    const extended = finalPassSegment(SQUARE, 4);
    expect(extended.polyline).toEqual([...SQUARE.polyline, { x: 14, y: 10 }]);
    expect(extended.closed).toBe(false);
    expect(finalPassSegment(SQUARE, undefined)).toBe(SQUARE);
    const open: CutSegment = { polyline: SQUARE.polyline.slice(0, 3), closed: false };
    expect(finalPassSegment(open, 4)).toBe(open);
  });

  it('never overcuts across a tab gap: tabbed shapes are open bridges', () => {
    const bridges = applyAutomaticTabsToPolylines([{ points: SQUARE.polyline, closed: true }], {
      tabsEnabled: true,
      tabSizeMm: 1,
      tabsPerShape: 2,
      tabSkipInnerShapes: false,
    }).map((polyline) => ({ polyline: polyline.points, closed: polyline.closed }));
    expect(bridges).toHaveLength(2);
    for (const bridge of bridges) expect(finalPassSegment(bridge, 3)).toBe(bridge);
  });
});

describe('overcut emission', () => {
  it('adds the tail to the final pass of the G-code only', () => {
    const plain = grblStrategy.emit(cutJob([SQUARE]), DEFAULT_DEVICE_PROFILE);
    const withOvercut = grblStrategy.emit(
      cutJob([SQUARE], { overcutMm: 4 }),
      DEFAULT_DEVICE_PROFILE,
    );
    const passes = withOvercut.split('; pass ');
    expect(passes).toHaveLength(3);
    expect(burnLines(passes[1] ?? '')).not.toContainEqual(
      expect.stringMatching(/^G1 X14\.000 Y10\.000/),
    );
    expect(burnLines(passes[2] ?? '').at(-1)).toMatch(/^G1 X14\.000 Y10\.000/);
    expect(burnLines(withOvercut)).toHaveLength(burnLines(plain).length + 1);
  });

  it('keeps output byte-identical when no overcut is set', () => {
    const job = cutJob([SQUARE]);
    expect(
      grblStrategy.emit(cutJob([SQUARE], { overcutMm: undefined }), DEFAULT_DEVICE_PROFILE),
    ).toBe(grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
  });

  it('previews the tail on the final pass, like the emitter', () => {
    const cuts = buildToolpath(cutJob([SQUARE], { overcutMm: 4 })).steps.filter(
      (step) => step.kind === 'cut',
    );
    expect(cuts).toHaveLength(2);
    expect(cuts[0]?.kind === 'cut' ? cuts[0].polyline : []).toEqual(SQUARE.polyline);
    expect(cuts[1]?.kind === 'cut' ? cuts[1].polyline.at(-1) : null).toEqual({ x: 14, y: 10 });
    expect(cuts[1]?.length).toBeCloseTo(44, 9);
  });

  it('extends the Ruida final pass instead of re-closing the loop', () => {
    const encoded = encodeRdJob(cutJob([SQUARE], { overcutMm: 4 }), DEFAULT_DEVICE_PROFILE);
    const plain = encodeRdJob(cutJob([SQUARE]), DEFAULT_DEVICE_PROFILE);
    if (!encoded.ok || !plain.ok) throw new Error('encode failed');
    const tail = cutAbsolute(14_000, 10_000);
    expect(
      occurrences(
        [...encoded.bytes].map((byte) => unswizzleByte(byte)),
        tail,
      ),
    ).toBe(1);
    expect(
      occurrences(
        [...plain.bytes].map((byte) => unswizzleByte(byte)),
        tail,
      ),
    ).toBe(0);
  });
});

function occurrences(haystack: ReadonlyArray<number>, needle: ReadonlyArray<number>): number {
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((byte, offset) => haystack[i + offset] === byte)) count += 1;
  }
  return count;
}
