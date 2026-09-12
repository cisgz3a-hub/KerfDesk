import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import type { PreparedPreviewFrame, PreviewDisplayStep } from './preview-route-frame';
import {
  packPreviewFrame,
  packedPreviewFrameTransfers,
  unpackPreviewFrame,
  type PackedPreviewFrame,
} from './preview-route-frame-transfer';

const from = Object.freeze({ x: -0, y: 1 / 3 });
const to = Object.freeze({ x: 1 + Number.EPSILON, y: -Number.MIN_VALUE });
const steps: ReadonlyArray<PreviewDisplayStep> = Object.freeze([
  Object.freeze({ kind: 'cut', polyline: Object.freeze([]) }),
  Object.freeze({ kind: 'travel', from, to }),
  Object.freeze({ kind: 'cut', polyline: Object.freeze([from, to, to]) }),
  Object.freeze({ kind: 'travel', from: to, to: from, motion: 'rapid' }),
  Object.freeze({ kind: 'cut', polyline: Object.freeze([to]) }),
  Object.freeze({ kind: 'travel', from, to, motion: 'feed' }),
]);
const frame: PreparedPreviewFrame = Object.freeze({
  futureSteps: steps,
  wholeSteps: Object.freeze([steps[3]!, steps[0]!, steps[2]!]),
  partial: Object.freeze({ kind: 'cut', polyline: Object.freeze([to, from]) }),
  head: to,
  start: from,
  end: Object.freeze({ x: 987.654321, y: -123.456789 }),
});

describe('transferable Preview display frames', () => {
  it('preserves ordered commands, all motion variants, repeated points and markers', () => {
    const packed = packPreviewFrame(frame);
    const decoded = unpackPreviewFrame(packed);
    expect(decoded).toStrictEqual(frame);
    expect(Object.is(decoded.start?.x, -0)).toBe(true);
    expect(Object.hasOwn(decoded.futureSteps[1]!, 'motion')).toBe(false);
    expect(Object.hasOwn(decoded.futureSteps[3]!, 'motion')).toBe(true);
    expect(Object.keys(packed).sort()).toEqual(['commands', 'coordinates']);
    expect(packed.coordinates).toBeInstanceOf(Float64Array);
    expect(packed.commands).toBeInstanceOf(Uint32Array);
  });

  it('handles empty frames and every partial/marker presence combination', () => {
    for (const partial of [null, ...steps]) {
      for (let mask = 0; mask < 8; mask++) {
        const candidate: PreparedPreviewFrame = {
          futureSteps: [],
          wholeSteps: [],
          partial,
          head: mask & 1 ? from : null,
          start: mask & 2 ? to : null,
          end: mask & 4 ? from : null,
        };
        expect(unpackPreviewFrame(packPreviewFrame(candidate))).toStrictEqual(candidate);
      }
    }
  });

  it('retains an explicitly undefined optional motion from runtime callers', () => {
    const explicit: PreviewDisplayStep = { kind: 'travel', from, to };
    Object.assign(explicit, { motion: undefined });
    const candidate = { ...frame, wholeSteps: [explicit] };
    const decoded = unpackPreviewFrame(packPreviewFrame(candidate));
    expect(Object.hasOwn(decoded.wholeSteps[0]!, 'motion')).toBe(true);
    expect(decoded).toStrictEqual(candidate);
  });

  it('copies doubles without rounding or losing signed zero and nonfinite values', () => {
    const numbers = [
      0,
      -0,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
      1 + Number.EPSILON,
      1 / 3,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    const candidate: PreparedPreviewFrame = {
      ...frame,
      wholeSteps: [{ kind: 'cut', polyline: numbers.map((x) => ({ x, y: -x })) }],
    };
    const decoded = unpackPreviewFrame(packPreviewFrame(candidate));
    expect(sameFrameValues(decoded, candidate)).toBe(true);
  });

  it('transfers only its own buffers, leaving frozen source frames reusable', () => {
    const packed = packPreviewFrame(frame);
    const transfers = packedPreviewFrameTransfers(packed);
    expect(transfers).toEqual([packed.coordinates.buffer, packed.commands.buffer]);
    const received = structuredClone(packed, { transfer: transfers });
    expect(packed.coordinates.byteLength).toBe(0);
    expect(packed.commands.byteLength).toBe(0);
    expect(unpackPreviewFrame(received)).toStrictEqual(frame);
    const decodedAgain = unpackPreviewFrame(packPreviewFrame(frame));
    expect(decodedAgain).toStrictEqual(frame);
    expect(decodedAgain.futureSteps).not.toBe(frame.futureSteps);
    expect(decodedAgain.head).not.toBe(frame.head);
  });

  it('round trips 240,000 mixed display commands through two transferable buffers', () => {
    const selected = Array.from({ length: 120_000 }, (_, index): PreviewDisplayStep => {
      const point = { x: index / 7, y: index === 0 ? -0 : -index / 11 };
      if (index % 4 === 0) return { kind: 'cut', polyline: [from, point, to] };
      if (index % 4 === 1) return { kind: 'travel', from, to: point };
      return {
        kind: 'travel',
        from: point,
        to,
        motion: index % 4 === 2 ? 'rapid' : 'feed',
      };
    });
    const candidate: PreparedPreviewFrame = {
      ...frame,
      futureSteps: selected,
      wholeSteps: selected.slice(0, -1),
      partial: selected.at(-1)!,
    };
    const packed = packPreviewFrame(candidate);
    expect(packed.commands.byteLength).toBe(16 + 240_000 * 8);
    expect(packed.coordinates.byteLength).toBe(240_000 * 36 + 3 * 16);
    const received = structuredClone(packed, { transfer: packedPreviewFrameTransfers(packed) });
    expect(sameFrameValues(unpackPreviewFrame(received), candidate)).toBe(true);
  });

  it.each([
    [
      'unsupported version',
      (packed: PackedPreviewFrame) => {
        packed.commands[0] = 2;
      },
    ],
    [
      'wrong command count',
      (packed: PackedPreviewFrame) => {
        packed.commands[1] = 1;
      },
    ],
    [
      'unknown presence bits',
      (packed: PackedPreviewFrame) => {
        packed.commands[3] = 16;
      },
    ],
    [
      'unknown opcode',
      (packed: PackedPreviewFrame) => {
        packed.commands[4] = 5;
      },
    ],
    [
      'wrong travel size',
      (packed: PackedPreviewFrame) => {
        packed.commands[7] = 1;
      },
    ],
    [
      'unavailable cut points',
      (packed: PackedPreviewFrame) => {
        packed.commands[5] = 0xffff_ffff;
      },
    ],
  ])('rejects %s before returning a partial frame', (_, corrupt) => {
    const packed = packPreviewFrame(frame);
    corrupt(packed);
    expect(() => unpackPreviewFrame(packed)).toThrow('Invalid Preview display');
  });

  it('rejects truncated headers and missing or trailing coordinates', () => {
    const packed = packPreviewFrame(frame);
    expect(() =>
      unpackPreviewFrame({ ...packed, commands: packed.commands.slice(0, 3) }),
    ).toThrow();
    for (const coordinates of [
      packed.coordinates.slice(0, -1),
      new Float64Array(packed.coordinates.length + 1),
    ]) {
      expect(() => unpackPreviewFrame({ ...packed, coordinates })).toThrow();
    }
  });
});

function sameFrameValues(a: PreparedPreviewFrame, b: PreparedPreviewFrame): boolean {
  return (
    sameSteps(a.futureSteps, b.futureSteps) &&
    sameSteps(a.wholeSteps, b.wholeSteps) &&
    sameStep(a.partial, b.partial) &&
    samePoint(a.head, b.head) &&
    samePoint(a.start, b.start) &&
    samePoint(a.end, b.end)
  );
}

function sameSteps(
  a: ReadonlyArray<PreviewDisplayStep>,
  b: ReadonlyArray<PreviewDisplayStep>,
): boolean {
  return a.length === b.length && a.every((step, index) => sameStep(step, b[index] ?? null));
}

function sameStep(a: PreviewDisplayStep | null, b: PreviewDisplayStep | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'cut' && b.kind === 'cut') {
    return (
      a.polyline.length === b.polyline.length &&
      a.polyline.every((point, index) => samePoint(point, b.polyline[index] ?? null))
    );
  }
  return (
    a.kind === 'travel' &&
    b.kind === 'travel' &&
    Object.hasOwn(a, 'motion') === Object.hasOwn(b, 'motion') &&
    a.motion === b.motion &&
    samePoint(a.from, b.from) &&
    samePoint(a.to, b.to)
  );
}

function samePoint(a: Vec2 | null, b: Vec2 | null): boolean {
  return a === null || b === null ? a === b : Object.is(a.x, b.x) && Object.is(a.y, b.y);
}
