import { describe, expect, it } from 'vitest';
import type { ColoredPath, Vec2 } from '../../scene';
import type { RawImageData, TraceOptions } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { traceOptionsForCommitGrid } from '../../../ui/trace/trace-commit-grid';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from './hybrid-paths';

const BASE = { width: 200, height: 120 };
const OPTIONS: TraceOptions = { ...TRACE_PRESETS['Line + fill']!, hybridMaxStrokeWidthPx: 4 };

function inBox(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  return x >= left && x < right && y >= top && y < bottom;
}

function squareRing(topWidth = 5): RawImageData {
  const width = 75;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 10; y < 65; y += 1)
    for (let x = 10; x < 65; x += 1)
      if (!inBox(x, y, 15, 10 + topWidth, 60, 60)) data.set([0, 0, 0, 255], (y * width + x) * 4);
  return { width, height: width, data };
}

function drawing(
  wideFrom = 120,
  wideTo = 150,
  wideWidth: number | ((x: number) => number) = 6,
): RawImageData {
  const data = new Uint8ClampedArray(BASE.width * BASE.height * 4).fill(255);
  for (let y = 0; y < BASE.height; y += 1) {
    for (let x = 0; x < BASE.width; x += 1) {
      const thin = inBox(x, y, 15, 49, 150, 51);
      const width = typeof wideWidth === 'number' ? wideWidth : wideWidth(x + 0.5);
      const top = 50 - (typeof wideWidth === 'number' ? Math.floor(width / 2) : width / 2);
      const fat = inBox(x + 0.5, y + 0.5, wideFrom, top, wideTo, top + width);
      const square = inBox(x, y, 160, 75, 190, 105);
      if (thin || fat || square) data.set([0, 0, 0, 255], (y * BASE.width + x) * 4);
    }
  }
  return { ...BASE, data };
}

function angledDrawing(degrees: number) {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  const image = drawing(0, 0);
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) {
      if (x >= 160 && y >= 75) continue;
      const dx = x + 0.5 - 100,
        dy = y + 0.5 - 60;
      const along = dx * c + dy * s,
        across = -dx * s + dy * c;
      const half = along >= 35 ? 3 : 1;
      const ink = along >= -65 && along <= 65 && Math.abs(across) < half;
      image.data.set(ink ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * image.width + x) * 4);
    }
  return { image, point: (along: number) => ({ x: 100 + along * c, y: 60 + along * s }) };
}

function transformed(image: RawImageData, scale: number, turn = 0, mirror = false) {
  const odd = turn % 2 === 1;
  const width = (odd ? image.height : image.width) * scale;
  const height = (odd ? image.width : image.height) * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const point = (p: Vec2): Vec2 => {
    let x = mirror ? image.width - p.x : p.x;
    let y = p.y;
    let w = image.width;
    let h = image.height;
    for (let i = 0; i < turn; i += 1) {
      [x, y] = [h - y, x];
      [w, h] = [h, w];
    }
    return { x: x * scale, y: y * scale };
  };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4] !== 0) continue;
      const p = point({ x: x + 0.5, y: y + 0.5 });
      const left = Math.floor(p.x / scale) * scale;
      const top = Math.floor(p.y / scale) * scale;
      for (let dy = 0; dy < scale; dy += 1)
        for (let dx = 0; dx < scale; dx += 1)
          data.set([0, 0, 0, 255], ((top + dy) * width + left + dx) * 4);
    }
  }
  return { image: { width, height, data }, point };
}

function fillContains(paths: readonly ColoredPath[], p: Vec2): boolean {
  return paths
    .filter((path) => path.color === HYBRID_FILL_COLOR)
    .some((path) => {
      let inside = false;
      for (const line of path.polylines) {
        if (!line.closed) continue;
        for (let i = 0, j = line.points.length - 1; i < line.points.length; j = i, i += 1) {
          const a = line.points[i]!;
          const b = line.points[j]!;
          if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
            inside = !inside;
        }
      }
      return inside;
    });
}

function distance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function strokeDistance(paths: readonly ColoredPath[], p: Vec2): number {
  let nearest = Infinity;
  for (const path of paths.filter((path) => path.color === HYBRID_STROKE_COLOR))
    for (const line of path.polylines)
      for (let i = 1; i < line.points.length; i += 1)
        nearest = Math.min(nearest, distance(p, line.points[i - 1]!, line.points[i]!));
  return nearest;
}

function assertSplit(paths: readonly ColoredPath[], point: (p: Vec2) => Vec2, scale: number) {
  expect(fillContains(paths, point({ x: 136, y: 48 }))).toBe(true);
  expect(fillContains(paths, point({ x: 170, y: 85 }))).toBe(true);
  expect(fillContains(paths, point({ x: 60, y: 50 }))).toBe(false);
  const strokes = paths
    .filter((path) => path.color === HYBRID_STROKE_COLOR)
    .flatMap((path) => path.polylines);
  expect(strokes).toHaveLength(1);
  expect(strokeDistance(paths, point({ x: 60, y: 50 }))).toBeLessThan(scale);
  expect(strokeDistance(paths, point({ x: 136, y: 50 }))).toBeGreaterThan(8 * scale);
  expect(
    strokes.some((stroke) =>
      [stroke.points[0]!, stroke.points.at(-1)!].some((p) => fillContains(paths, p)),
    ),
  ).toBe(true);
}

describe('Line + fill local width classification', () => {
  it.each([1, 2, 4])(
    'keeps a uniformly wide square ring filled through its unmeasurable bends at %ix',
    async (scale) => {
      const { image, point } = transformed(squareRing(), scale);
      const paths = await traceImageToColoredPaths(image, {
        ...OPTIONS,
        hybridMaxStrokeWidthPx: 4 * scale,
      });
      expect(paths.filter((path) => path.color === HYBRID_STROKE_COLOR)).toHaveLength(0);
      expect(
        paths.filter((path) => path.color === HYBRID_FILL_COLOR).flatMap((path) => path.polylines),
      ).toHaveLength(2);
      let filled = 0;
      for (let y = 0; y < image.height; y += 1)
        for (let x = 0; x < image.width; x += 1)
          if (
            image.data[(y * image.width + x) * 4] === 0 &&
            fillContains(paths, { x: x + 0.5, y: y + 0.5 })
          )
            filled += 1;
      expect(filled).toBe(1000 * scale * scale);
      expect(fillContains(paths, point({ x: 37.5, y: 37.5 }))).toBe(false);
    },
  );

  it.each([1, 2, 4])('retains a narrow side of a closed mixed-width ring at %ix', async (scale) => {
    for (const turn of [0, 1, 2, 3]) {
      const { image, point } = transformed(squareRing(2), scale, turn, turn % 2 === 1);
      const paths = await traceImageToColoredPaths(image, {
        ...OPTIONS,
        hybridMaxStrokeWidthPx: 4 * scale,
      });
      expect(fillContains(paths, point({ x: 37.5, y: 11 }))).toBe(false);
      expect(strokeDistance(paths, point({ x: 37.5, y: 11 }))).toBeLessThan(scale);
      for (const p of [
        { x: 12.5, y: 37.5 },
        { x: 62.5, y: 37.5 },
        { x: 37.5, y: 62.5 },
      ]) {
        expect(fillContains(paths, point(p))).toBe(true);
        expect(strokeDistance(paths, point(p))).toBeGreaterThan(10 * scale);
      }
      expect(fillContains(paths, point({ x: 37.5, y: 37.5 }))).toBe(false);
      expect(
        paths
          .filter((path) => path.color === HYBRID_STROKE_COLOR)
          .flatMap((path) => path.polylines),
      ).toHaveLength(1);
    }
  });

  it.each([1, 2, 4])(
    'does not grow across a thin connector between wide sections at %ix',
    async (scale) => {
      const source = drawing(15, 150, (x) => (x >= 75 && x < 87 ? 2 : 5));
      const { image, point } = transformed(source, scale);
      const paths = await traceImageToColoredPaths(image, {
        ...OPTIONS,
        hybridMaxStrokeWidthPx: 4 * scale,
      });
      expect(fillContains(paths, point({ x: 81, y: 50 }))).toBe(false);
      expect(strokeDistance(paths, point({ x: 81, y: 50 }))).toBeLessThan(scale);
      for (const x of [40, 110]) {
        expect(fillContains(paths, point({ x, y: 50 }))).toBe(true);
        expect(strokeDistance(paths, point({ x, y: 50 }))).toBeGreaterThan(15 * scale);
      }
      expect(
        paths
          .filter((path) => path.color === HYBRID_STROKE_COLOR)
          .flatMap((path) => path.polylines),
      ).toHaveLength(1);
    },
  );

  // ADR-454 Amendment 3: a hand-drawn line wobbling between 5 and 4 px at a
  // 4 px gate is one fill, not alternating fill and stroke that burn twice
  // at every join.
  it.each([1, 2, 4])('keeps a line wobbling around the gate in one fill at %ix', async (scale) => {
    const source = drawing(15, 150, (x) => (Math.floor((x - 15) / 15) % 2 === 0 ? 5 : 4));
    const { image, point } = transformed(source, scale);
    const paths = await traceImageToColoredPaths(image, {
      ...OPTIONS,
      hybridMaxStrokeWidthPx: 4 * scale,
    });
    expect(paths.filter((path) => path.color === HYBRID_STROKE_COLOR)).toHaveLength(0);
    for (let x = 17; x < 150; x += 5) expect(fillContains(paths, point({ x, y: 50 }))).toBe(true);
  });

  it.each([1, 2, 4])(
    'keeps a thin stroke attached to its wide end at %ix source resolution',
    async (scale) => {
      const { image, point } = transformed(drawing(), scale);
      const paths = await traceImageToColoredPaths(image, {
        ...OPTIONS,
        hybridMaxStrokeWidthPx: 4 * scale,
      });
      assertSplit(paths, point, scale);
    },
  );

  it.each([0, 1, 2, 3])('keeps the split under quarter turn %i and reflection', async (turn) => {
    for (const mirror of [false, true]) {
      const { image, point } = transformed(drawing(), 1, turn, mirror);
      assertSplit(await traceImageToColoredPaths(image, OPTIONS), point, 1);
    }
  });

  it('uses the same physical limit after preview-to-commit conversion', async () => {
    const { image, point } = transformed(drawing(), 2);
    const options = traceOptionsForCommitGrid(OPTIONS, { preview: BASE, grid: image });
    expect(options.hybridMaxStrokeWidthPx).toBe(8);
    assertSplit(await traceImageToColoredPaths(image, options), point, 2);
  });

  it('keeps the short thin end when most of the branch is wide', async () => {
    const paths = await traceImageToColoredPaths(drawing(15, 120), OPTIONS);
    expect(fillContains(paths, { x: 70, y: 48 })).toBe(true);
    expect(fillContains(paths, { x: 138, y: 50 })).toBe(false);
    expect(strokeDistance(paths, { x: 138, y: 50 })).toBeLessThan(1);
    expect(strokeDistance(paths, { x: 70, y: 50 })).toBeGreaterThan(30);
  });

  it.each([15, 30, 45])('splits local widths along a %i degree stroke', async (angle) => {
    const { image, point } = angledDrawing(angle);
    const paths = await traceImageToColoredPaths(image, OPTIONS);
    expect(fillContains(paths, point(55))).toBe(true);
    expect(fillContains(paths, point(-35))).toBe(false);
    expect(strokeDistance(paths, point(-35))).toBeLessThan(1);
    expect(strokeDistance(paths, point(55))).toBeGreaterThan(8);
    const strokes = paths
      .filter((p) => p.color === HYBRID_STROKE_COLOR)
      .flatMap((p) => p.polylines);
    expect(strokes).toHaveLength(1);
    expect(
      strokes.some((stroke) =>
        [stroke.points[0]!, stroke.points.at(-1)!].some((p) => fillContains(paths, p)),
      ),
    ).toBe(true);
  });

  it.each([1, 2, 4])('keeps both attachments around a short wide island at %ix', async (scale) => {
    const { image, point } = transformed(drawing(80, 88), scale);
    const paths = await traceImageToColoredPaths(image, {
      ...OPTIONS,
      hybridMaxStrokeWidthPx: 4 * scale,
    });
    expect(fillContains(paths, point({ x: 84, y: 50 }))).toBe(true);
    for (const x of [60, 110]) {
      expect(fillContains(paths, point({ x, y: 50 }))).toBe(false);
      expect(strokeDistance(paths, point({ x, y: 50 }))).toBeLessThan(scale);
    }
    expect(strokeDistance(paths, point({ x: 84, y: 50 }))).toBeGreaterThan(scale);
    const strokes = paths
      .filter((p) => p.color === HYBRID_STROKE_COLOR)
      .flatMap((p) => p.polylines);
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes)
      expect([stroke.points[0]!, stroke.points.at(-1)!].some((p) => fillContains(paths, p))).toBe(
        true,
      );
  });

  it.each([1, 2, 4])(
    'splits a gradual taper at %ix without filling its thin run',
    async (scale) => {
      const { image, point } = transformed(
        drawing(100, 150, (x) => 2 + ((x - 100) * 4) / 50),
        scale,
      );
      const paths = await traceImageToColoredPaths(image, {
        ...OPTIONS,
        hybridMaxStrokeWidthPx: 4 * scale,
      });
      expect(fillContains(paths, point({ x: 145, y: 50 }))).toBe(true);
      expect(fillContains(paths, point({ x: 60, y: 50 }))).toBe(false);
      expect(strokeDistance(paths, point({ x: 60, y: 50 }))).toBeLessThan(scale);
      expect(strokeDistance(paths, point({ x: 145, y: 50 }))).toBeGreaterThan(2 * scale);
      expect(
        paths.filter((p) => p.color === HYBRID_STROKE_COLOR).flatMap((p) => p.polylines),
      ).toHaveLength(1);
    },
  );

  it.each([1, 2, 4])('preserves constant-width pens at %ix', async (scale) => {
    for (const width of [2, 4]) {
      const source = drawing(15, 150, width);
      const { image, point } = transformed(source, scale);
      const paths = await traceImageToColoredPaths(image, {
        ...OPTIONS,
        hybridMaxStrokeWidthPx: 4 * scale,
      });
      expect(fillContains(paths, point({ x: 60, y: 50 }))).toBe(false);
      const strokes = paths.filter((p) => p.color === HYBRID_STROKE_COLOR);
      expect(strokes.flatMap((p) => p.polylines)).toHaveLength(1);
      expect(strokes[0]!.strokeWidthMm).toBeCloseTo(width * scale, 0);
    }
  });

  it.each([1, 2, 4])('keeps a small pen blot out of fill at %ix', async (scale) => {
    const source = drawing(15, 150, 4);
    for (let x = 59; x < 62; x++) source.data.set([0, 0, 0, 255], (47 * source.width + x) * 4);
    const { image, point } = transformed(source, scale);
    const paths = await traceImageToColoredPaths(image, {
      ...OPTIONS,
      hybridMaxStrokeWidthPx: 4 * scale,
    });
    expect(fillContains(paths, point({ x: 60, y: 50 }))).toBe(false);
    const strokes = paths
      .filter((p) => p.color === HYBRID_STROKE_COLOR)
      .flatMap((p) => p.polylines);
    // The centreline can retain a short medial branch inside a coarse blot.
    // The main pen must remain one continuous stroke, with no fill or second
    // full-length stroke added by the local width classifier.
    const full = strokes.filter(
      (line) =>
        Math.hypot(
          line.points.at(-1)!.x - line.points[0]!.x,
          line.points.at(-1)!.y - line.points[0]!.y,
        ) >
        100 * scale,
    );
    expect(full).toHaveLength(1);
    expect(strokeDistance(paths, point({ x: 60, y: 50 }))).toBeLessThan(scale);
    expect(
      paths.filter((p) => p.color === HYBRID_FILL_COLOR).flatMap((p) => p.polylines),
    ).toHaveLength(1); // The independent square only.
  });

  it.each([1, 2, 4])(
    'honours either side of the measured width allowance at %ix',
    async (scale) => {
      const { image, point } = transformed(drawing(120, 150, 5), scale);
      for (const [gate, fill] of [
        [4.5, true],
        [4.75, false],
      ] as const) {
        const paths = await traceImageToColoredPaths(image, {
          ...OPTIONS,
          hybridMaxStrokeWidthPx: gate * scale,
        });
        expect(fillContains(paths, point({ x: 136, y: 50 })), `gate ${gate}`).toBe(fill);
        expect(strokeDistance(paths, point({ x: 60, y: 50 }))).toBeLessThan(scale);
      }
    },
  );
});
