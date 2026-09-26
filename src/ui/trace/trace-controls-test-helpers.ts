import type { RawImageData, TraceOptions } from '../../core/trace';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';

// Raster fixtures and probes shared by the trace-controls semantic tests.
export function paper(gray = 255): RawImageData {
  const data = new Uint8ClampedArray(80 * 60 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([gray, gray, gray, 255], i);
  return { width: 80, height: 60, data };
}

export function fill(
  image: RawImageData,
  x0: number,
  y0: number,
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): void {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      image.data.set([...rgb, 255], (y * image.width + x) * 4);
    }
  }
}

export function ink(image: RawImageData): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i] === 0) count += 1;
  return count;
}

export async function loopCount(image: RawImageData, options: TraceOptions): Promise<number> {
  const paths = await traceImageToColoredPaths(image, options);
  return paths.reduce((count, path) => count + path.polylines.length, 0);
}
