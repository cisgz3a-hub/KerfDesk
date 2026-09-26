// Shared fixtures for the colour-layer trace tests (ADR-402).
import type { ColoredPath, Vec2 } from '../scene';
import { runTraceSteps } from './trace-steps';
import { traceColourLayersSteps } from './colour-layer-trace';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData, TraceOptions } from './trace-image';

export type Rgb = readonly [number, number, number];

export function canvas(width: number, height: number, fill: Rgb): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(
  image: RawImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: Rgb,
): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * image.width + x) * 4;
      (image.data as Uint8ClampedArray)[o] = c[0];
      (image.data as Uint8ClampedArray)[o + 1] = c[1];
      (image.data as Uint8ClampedArray)[o + 2] = c[2];
    }
  }
}

export function fillDisc(image: RawImageData, cx: number, cy: number, r: number, c: Rgb): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r)
        fillRect(image, x, y, x + 1, y + 1, c);
    }
  }
}

// Box-filtered (8x8 supersampled, sRGB-averaged) rendering: anti-aliased art.
export function render(
  width: number,
  height: number,
  colourAt: (x: number, y: number) => Rgb,
): RawImageData {
  const image = canvas(width, height, [0, 0, 0]);
  const data = image.data as Uint8ClampedArray;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum: [number, number, number] = [0, 0, 0];
      for (let sy = 0; sy < 8; sy += 1) {
        for (let sx = 0; sx < 8; sx += 1) {
          const c = colourAt(x + (sx + 0.5) / 8, y + (sy + 0.5) / 8);
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      }
      const o = (y * width + x) * 4;
      data[o] = Math.round(sum[0] / 64);
      data[o + 1] = Math.round(sum[1] / 64);
      data[o + 2] = Math.round(sum[2] / 64);
    }
  }
  return image;
}

export function polygonArea(path: ColoredPath): number {
  let area = 0;
  for (const polyline of path.polylines) {
    const pts = polyline.points;
    let ring = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const a = pts[i] as Vec2;
      const b = pts[j] as Vec2;
      ring += (b.x - a.x) * (b.y + a.y);
    }
    area += ring / 2;
  }
  return Math.abs(area);
}

export function lightness(hex: string): number {
  const v = Number.parseInt(hex.slice(1), 16);
  return ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255);
}

export const OPTIONS: TraceOptions = {
  ...(TRACE_PRESETS['Colour layers'] as TraceOptions),
};

export function trace(image: RawImageData, options: TraceOptions = OPTIONS): ColoredPath[] {
  return runTraceSteps(traceColourLayersSteps(image, options));
}

// Even-odd point-in-polygon over every closed polyline of a path.
export function covers(path: ColoredPath, p: Vec2): boolean {
  let inside = false;
  for (const polyline of path.polylines) {
    const pts = polyline.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const a = pts[i] as Vec2;
      const b = pts[j] as Vec2;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// Rasterise every path at 4x4 samples per pixel; returns per-sample coverage
// counts so union and pairwise overlaps can be measured.
export function coverageStats(
  paths: ReadonlyArray<ColoredPath>,
  width: number,
  height: number,
): { readonly counts: Uint8Array; readonly perPath: Uint8Array[] } {
  const samples = width * 4 * height * 4;
  const counts = new Uint8Array(samples);
  const perPath = paths.map(() => new Uint8Array(samples));
  let s = 0;
  for (let sy = 0; sy < height * 4; sy += 1) {
    for (let sx = 0; sx < width * 4; sx += 1) {
      const p = { x: (sx + 0.5) / 4 + 0.0013, y: (sy + 0.5) / 4 + 0.0017 };
      paths.forEach((path, index) => {
        if (covers(path, p)) {
          (perPath[index] as Uint8Array)[s] = 1;
          counts[s] = (counts[s] as number) + 1;
        }
      });
      s += 1;
    }
  }
  return { counts, perPath };
}

export function rgbImage(): RawImageData {
  const image = canvas(60, 40, [255, 255, 255]);
  fillRect(image, 10, 8, 30, 20, [220, 30, 30]);
  fillRect(image, 30, 8, 50, 20, [30, 160, 40]);
  fillRect(image, 10, 20, 50, 32, [30, 50, 200]);
  return image;
}
