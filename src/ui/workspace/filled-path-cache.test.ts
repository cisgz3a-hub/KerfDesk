import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Transform,
} from '../../core/scene';
import { drawCachedClosedFill, FilledPathCache } from './filled-path-cache';

class RecordedPath {
  readonly commands: Array<readonly [string, number, number]> = [];
  moveTo(x: number, y: number) {
    this.commands.push(['move', x, y]);
  }
  lineTo(x: number, y: number) {
    this.commands.push(['line', x, y]);
  }
}
const ctor = RecordedPath as unknown as typeof Path2D;
const triangle = (x = 0): ReadonlyArray<Polyline> => [
  {
    closed: true,
    points: [
      { x, y: 0 },
      { x: x + 1, y: 0 },
      { x, y: 1 },
    ],
  },
];

afterEach(() => vi.unstubAllGlobals());

describe('native filled-path cache', () => {
  it('includes an existing context transform in the screen precision check', () => {
    vi.stubGlobal('Path2D', ctor);
    const ctx = {
      save: vi.fn(),
      fill: vi.fn(),
      getTransform: () => ({
        a: 1e8,
        b: 0,
        c: 0,
        d: 1e8,
        e: 0,
        f: 0,
      }),
    } as unknown as CanvasRenderingContext2D;
    expect(
      drawCachedClosedFill(
        ctx,
        triangle(1000.125),
        IDENTITY_TRANSFORM,
        { scale: 1, offsetX: -1000, offsetY: 0 },
        'evenodd',
      ),
    ).toBe(false);
  });

  it('retains complete closed geometry in source order while ignoring open strokes', () => {
    const outer = triangle();
    const inner = triangle(0.25);
    const source = Object.freeze([...outer, { ...outer[0]!, closed: false }, ...inner]);
    const before = structuredClone(source);
    const cache = new FilledPathCache();
    const first = cache.get(source, ctor) as unknown as RecordedPath;
    expect(first.commands).toEqual([
      ['move', 0, 0],
      ['line', 1, 0],
      ['line', 0, 1],
      ['move', 0.25, 0],
      ['line', 1.25, 0],
      ['line', 0.25, 1],
    ]);
    expect(cache.get(source, ctor)).toBe(first);
    expect(cache.get([...source], ctor)).not.toBe(first);
    expect(source).toEqual(before);
  });

  it('bounds retained entries by recency and recompiles an evicted source', () => {
    const cache = new FilledPathCache(100, 2);
    const a = triangle(0),
      b = triangle(1),
      c = triangle(2);
    const first = cache.get(a, ctor),
      second = cache.get(b, ctor);
    expect(cache.get(a, ctor)).toBe(first);
    cache.get(c, ctor);
    expect(cache.get(a, ctor)).toBe(first);
    expect(cache.get(b, ctor)).not.toBe(second);
  });

  it('enforces the ordinary point budget while retaining one oversized path', () => {
    const cache = new FilledPathCache(5, 8);
    const a = triangle(0),
      b = triangle(1),
      large = [...triangle(2), ...triangle(3)];
    const first = cache.get(a, ctor);
    cache.get(b, ctor);
    expect(cache.get(a, ctor)).not.toBe(first);
    const oversized = cache.get(large, ctor);
    expect(cache.get(large, ctor)).toBe(oversized);
    cache.get(b, ctor);
    expect(cache.get(large, ctor)).toBe(oversized);
    cache.get([...triangle(4), ...triangle(5)], ctor);
    expect(cache.get(large, ctor)).not.toBe(oversized);
  });

  it('reuses a large fill while later small decorations cycle through the bounded cache', () => {
    const cache = new FilledPathCache(5, 2);
    const large = [...triangle(0), ...triangle(1)];
    const native = cache.get(large, ctor);
    const decorations = [triangle(2), triangle(3), triangle(4)];
    for (let frame = 0; frame < 5; frame++) {
      expect(cache.get(large, ctor)).toBe(native);
      for (const decoration of decorations) {
        expect(cache.get(decoration, ctor)).toBeInstanceOf(RecordedPath);
      }
    }
    expect(cache.get(large, ctor)).toBe(native);
  });

  it('invalidates native paths when their constructor changes', () => {
    const cache = new FilledPathCache();
    const source = triangle();
    const first = cache.get(source, ctor);
    class Replacement extends RecordedPath {}
    const second = cache.get(source, Replacement as unknown as typeof Path2D);
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(Replacement);
  });

  it.each([
    { ...IDENTITY_TRANSFORM, x: 12.5, y: -17.25 },
    { ...IDENTITY_TRANSFORM, rotationDeg: 37, scaleX: 2, scaleY: 0.25, mirrorX: true },
    { ...IDENTITY_TRANSFORM, x: -10, rotationDeg: -113, scaleX: -3, scaleY: 2, mirrorY: true },
  ] satisfies Transform[])(
    'matches scene transform order for %j while reusing native geometry',
    (transform) => {
      vi.stubGlobal('Path2D', ctor);
      const calls = { save: vi.fn(), restore: vi.fn(), transform: vi.fn(), fill: vi.fn() };
      const ctx = calls as unknown as CanvasRenderingContext2D;
      const source = triangle(3.125);
      for (const scale of [1, 3.83, 9.875]) {
        const view = { scale, offsetX: 6.75, offsetY: -2.5 };
        expect(drawCachedClosedFill(ctx, source, transform, view, 'nonzero')).toBe(true);
        const [a, b, c, d, e, f] = calls.transform.mock.lastCall as number[];
        for (const point of source[0]!.points) {
          const expected = applyTransform(point, transform);
          expect(a! * point.x + c! * point.y + e!).toBeCloseTo(
            expected.x * scale + view.offsetX,
            11,
          );
          expect(b! * point.x + d! * point.y + f!).toBeCloseTo(
            expected.y * scale + view.offsetY,
            11,
          );
        }
      }
      expect(calls.fill.mock.calls[0]![0]).toBe(calls.fill.mock.calls[2]![0]);
      expect(calls.fill.mock.calls.every((call) => call[1] === 'nonzero')).toBe(true);
      expect(calls.restore).toHaveBeenCalledTimes(3);
    },
  );

  it('allows the exact immediate fallback when Path2D is absent or construction fails', () => {
    const calls = { save: vi.fn(), fill: vi.fn() };
    const ctx = calls as unknown as CanvasRenderingContext2D;
    const draw = () =>
      drawCachedClosedFill(
        ctx,
        triangle(),
        IDENTITY_TRANSFORM,
        { scale: 1, offsetX: 0, offsetY: 0 },
        'evenodd',
      );
    vi.stubGlobal('Path2D', undefined);
    expect(draw()).toBe(false);
    vi.stubGlobal(
      'Path2D',
      class extends RecordedPath {
        constructor() {
          super();
          throw new Error('unavailable');
        }
      },
    );
    expect(draw()).toBe(false);
    expect(calls.save).not.toHaveBeenCalled();
    expect(calls.fill).not.toHaveBeenCalled();
  });

  it('restores the caller context if filling throws', () => {
    vi.stubGlobal('Path2D', ctor);
    const calls = {
      save: vi.fn(),
      restore: vi.fn(),
      transform: vi.fn(),
      fill: vi.fn(() => {
        throw new Error('context failure');
      }),
    };
    expect(() =>
      drawCachedClosedFill(
        calls as unknown as CanvasRenderingContext2D,
        triangle(),
        IDENTITY_TRANSFORM,
        { scale: 1, offsetX: 0, offsetY: 0 },
        'evenodd',
      ),
    ).toThrow('context failure');
    expect(calls.restore).toHaveBeenCalledExactlyOnceWith();
  });

  it('uses the full mapped fallback when native rounding could collapse a translated fine feature', () => {
    vi.stubGlobal('Path2D', ctor);
    const source: ReadonlyArray<Polyline> = [
      {
        closed: true,
        points: [
          { x: 1e8, y: 0 },
          { x: 1e8 + 0.2, y: 0 },
          { x: 1e8 + 0.2, y: 3 },
          { x: 1e8, y: 3 },
        ],
      },
    ];
    const calls = { save: vi.fn(), fill: vi.fn() };
    const ctx = calls as unknown as CanvasRenderingContext2D;
    expect(
      drawCachedClosedFill(
        ctx,
        source,
        { ...IDENTITY_TRANSFORM, x: -1e8 },
        { scale: 100, offsetX: 100, offsetY: 100 },
        'evenodd',
      ),
    ).toBe(false);
    expect(calls.save).not.toHaveBeenCalled();
    expect(calls.fill).not.toHaveBeenCalled();
  });

  it.each([
    { size: 1e40, scale: 1e-38 },
    { size: 1e-46, scale: 1e48 },
    { size: 1e-39, scale: 1e40 },
  ])('falls back for native coordinate range loss before scaling: %j', ({ size, scale }) => {
    vi.stubGlobal('Path2D', ctor);
    const source: ReadonlyArray<Polyline> = [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: size, y: 0 },
          { x: size, y: size },
        ],
      },
    ];
    const ctx = { save: vi.fn(), fill: vi.fn() } as unknown as CanvasRenderingContext2D;
    expect(
      drawCachedClosedFill(
        ctx,
        source,
        { ...IDENTITY_TRANSFORM, scaleX: scale, scaleY: scale },
        { scale: 1, offsetX: 100, offsetY: 100 },
        'evenodd',
      ),
    ).toBe(false);
  });
});
