import { expect, it } from 'vitest';
import type { ColoredPath, Polyline } from '../scene';
import { traceImageToPhotoPathsSteps } from './photo-trace';
import { runTraceSteps } from './trace-steps';
import { DEFAULT_TRACE_OPTIONS, type RawImageData } from './trace-image';

function image(width: number, height: number, sample: (y: number) => number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.fill(sample(y), i, i + 3);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function trace(source: RawImageData): ColoredPath[] {
  return runTraceSteps(
    traceImageToPhotoPathsSteps(source, { ...DEFAULT_TRACE_OPTIONS, photoDetail: 100 }),
  );
}

// Measure horizontal coverage from the emitted polygons, independently of
// the ribbon construction, just as a scanline fill sees the shape.
function widthAt(paths: readonly ColoredPath[], y: number): number {
  let total = 0;
  for (const path of paths)
    for (const line of path.polylines) {
      const hits: number[] = [];
      for (let i = 0; i < line.points.length; i += 1) {
        const a = line.points[i]!,
          b = line.points[(i + 1) % line.points.length]!;
        if (a.y > y !== b.y > y) hits.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i < hits.length; i += 2) total += hits[i + 1]! - hits[i]!;
    }
  return total;
}

it('retains cell-centre contrast next to a sharp tone transition', () => {
  const paths = trace(image(1, 20, (y) => (y < 10 ? 32 : 224)));
  expect(widthAt(paths, 9.5)).toBeCloseTo(223 / 255, 12);
  expect(widthAt(paths, 10.5)).toBeCloseTo(31 / 255, 12);
  // Half-cell endpoints extend their own tone; they do not bleed beyond the source.
  expect(widthAt(paths, 0.1)).toBeCloseTo(223 / 255, 12);
  expect(widthAt(paths, 19.9)).toBeCloseTo(31 / 255, 12);
});

it('keeps complete white gaps and total tone while spending a fixed dense-geometry budget', () => {
  const source = image(1280, 1280, (y) => [80, 200, 255][Math.floor(y / 2) % 3]!);
  const paths = trace(source);
  const lines = paths.flatMap((path) => path.polylines);
  expect(lines.reduce((sum, line) => sum + line.points.length, 0)).toBeLessThanOrEqual(410240);
  let area = 0;
  let validBounds = true;
  for (const line of lines) {
    let twice = 0;
    for (let i = 0; i < line.points.length; i += 1) {
      const a = line.points[i]!,
        b = line.points[(i + 1) % line.points.length]!;
      twice += a.x * b.y - a.y * b.x;
      validBounds &&= Number.isFinite(a.x) && a.x >= 0 && a.x <= source.width;
    }
    area += Math.abs(twice) / 2;
  }
  let expected = 0;
  expect(validBounds).toBe(true);
  for (let i = 0; i < source.data.length; i += 4) expected += 1 - source.data[i]! / 255;
  expect(area / (source.width * source.height)).toBeCloseTo(
    expected / (source.width * source.height),
    10,
  );
  expect(widthAt(paths, 4.5)).toBe(0);
  expect(widthAt(paths, 1276.5)).toBe(0);
}, 20000);

it.each([
  { name: 'alternating gray rows', samples: [80, 200] },
  { name: 'white-separated pairs', samples: [80, 200, 255] },
])('keeps identical columns identical at the point ceiling: $name', ({ samples }) => {
  const paths = trace(image(640, 640, (y) => samples[y % samples.length]!));
  const columns: Polyline[][] = Array.from({ length: 320 }, () => []);
  let points = 0;
  for (const path of paths) {
    for (const line of path.polylines) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const point of line.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
      }
      const column = Math.floor((minX + maxX) / 4);
      columns[column]!.push(line);
      points += line.points.length;
    }
  }
  expect(points).toBeLessThanOrEqual(410240);
  // Read coverage from actual polygons at both ends and several inner rows.
  // A traversal-order budget must not add vertical bands to horizontal stripes.
  for (const y of [0, 1, 2, 3, 4, 317, 638, 639]) {
    const widths = columns.map(
      (polylines) => widthAt([{ color: '#000000', polylines }], y + 0.5) / 2,
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1e-9);
    if (samples[y % samples.length] === 255) expect(Math.max(...widths)).toBe(0);
  }
});
