import type { CrackSubPixelField } from './contour-boundary';
import { coherentContourDetailMask } from './contour-detail-detector';
import type { ContourTraceInput } from './contour-input';
import { isValidRawImageData, type RawImageData } from './trace-image';

type SupportGrid = {
  readonly source: RawImageData;
  readonly enlarged: RawImageData;
  readonly factor: number;
  readonly restored: Uint8Array;
};

/** Restore only genuinely erased source detail after optional bilinear
 * enlargement. The accepted native mask supplies a local, bilinear support
 * field, with its matching threshold, where the enlarged detector has lost a
 * coherent thin stroke or a complete paper counter. All other measured edges
 * keep their original enlarged mask and scalar field. */
export function restoreEnlargedContourSupport(
  source: ContourTraceInput,
  enlarged: ContourTraceInput,
  factor: number,
): ContourTraceInput {
  if (!matchingGrids(source.prepared, enlarged.prepared, factor)) return enlarged;
  const grid: SupportGrid = {
    source: source.prepared,
    enlarged: enlarged.prepared,
    factor,
    restored: new Uint8Array(source.prepared.width * source.prepared.height),
  };
  restoreErasedThinInk(grid);
  restoreErasedPaper(grid);
  if (!grid.restored.some((value) => value === 1)) return enlarged;
  return {
    ...enlarged,
    prepared: restoredMask(grid),
    crackField: restoredField(grid, enlarged.crackField),
  };
}

function matchingGrids(source: RawImageData, enlarged: RawImageData, factor: number): boolean {
  return (
    isValidRawImageData(source) &&
    isValidRawImageData(enlarged) &&
    Number.isInteger(factor) &&
    factor > 1 &&
    enlarged.width === source.width * factor &&
    enlarged.height === source.height * factor
  );
}

function restoreErasedThinInk(grid: SupportGrid): void {
  const coherent = coherentContourDetailMask(grid.source);
  for (let index = 0; index < coherent.length; index += 1) {
    if (coherent[index] !== 1 || !inkAt(grid.source, index)) continue;
    const x = index % grid.source.width;
    const y = Math.floor(index / grid.source.width);
    // A half-source-pixel neighbourhood tolerates a normal subpixel edge
    // shift. A missing stroke, including one attached to a broad component,
    // has no enlarged ink witness even there.
    if (!cellHasClass(grid, x, y, true, Math.floor(grid.factor / 2))) {
      markRestoredNeighbourhood(grid, index);
    }
  }
}

function restoreErasedPaper(grid: SupportGrid): void {
  const visited = new Uint8Array(grid.restored.length);
  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index] !== 0 || inkAt(grid.source, index)) continue;
    const x = index % grid.source.width;
    const y = Math.floor(index / grid.source.width);
    if (cellHasClass(grid, x, y, false)) {
      visited[index] = 1;
      continue;
    }
    const { pixels, retained } = paperSupport(grid, visited, index);
    for (const pixel of pixels) {
      visited[pixel] = 1;
      if (!retained) markRestoredNeighbourhood(grid, pixel);
    }
  }
}

/** Search only until a connected paper witness is found. Every queued pixel
 * is connected to that witness; caching this result avoids repeatedly walking
 * the large background from ordinary shifted boundary cells. */
function paperSupport(
  grid: SupportGrid,
  visited: Uint8Array,
  start: number,
): { pixels: number[]; retained: boolean } {
  const pixels = [start];
  visited[start] = 2;
  for (const index of pixels) {
    const x = index % grid.source.width;
    const y = Math.floor(index / grid.source.width);
    if (cellHasClass(grid, x, y, false)) return { pixels, retained: true };
    for (const next of paperNeighbours(grid.source, x, y)) {
      if (visited[next] === 1) return { pixels, retained: true };
      if (visited[next] !== 0) continue;
      visited[next] = 2;
      pixels.push(next);
    }
  }
  return { pixels, retained: false };
}

function paperNeighbours(image: RawImageData, x: number, y: number): number[] {
  const indices: number[] = [];
  if (x > 0) indices.push(y * image.width + x - 1);
  if (x + 1 < image.width) indices.push(y * image.width + x + 1);
  if (y > 0) indices.push((y - 1) * image.width + x);
  if (y + 1 < image.height) indices.push((y + 1) * image.width + x);
  return indices.filter((index) => !inkAt(image, index));
}

function cellHasClass(grid: SupportGrid, x: number, y: number, ink: boolean, halo = 0): boolean {
  const x0 = Math.max(0, x * grid.factor - halo);
  const y0 = Math.max(0, y * grid.factor - halo);
  const x1 = Math.min(grid.enlarged.width, (x + 1) * grid.factor + halo);
  const y1 = Math.min(grid.enlarged.height, (y + 1) * grid.factor + halo);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      if (inkAt(grid.enlarged, yy * grid.enlarged.width + xx) === ink) return true;
    }
  }
  return false;
}

function markRestoredNeighbourhood(grid: SupportGrid, index: number): void {
  const x = index % grid.source.width;
  const y = Math.floor(index / grid.source.width);
  // Include the adjacent source cells so the reconstructed ramp has both
  // sides of the ink/paper boundary, not an inconsistent mask-only patch.
  for (let yy = Math.max(0, y - 1); yy <= Math.min(grid.source.height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(grid.source.width - 1, x + 1); xx += 1) {
      grid.restored[yy * grid.source.width + xx] = 1;
    }
  }
}

function restoredMask(grid: SupportGrid): RawImageData {
  const data = grid.enlarged.data.slice();
  for (let index = 0; index < grid.restored.length; index += 1) {
    if (grid.restored[index] !== 1) continue;
    const x = (index % grid.source.width) * grid.factor;
    const y = Math.floor(index / grid.source.width) * grid.factor;
    for (let dy = 0; dy < grid.factor; dy += 1) {
      for (let dx = 0; dx < grid.factor; dx += 1) {
        const value = supportLuma(grid, x + dx, y + dy) < 128 ? 0 : 255;
        data.set([value, value, value, 255], ((y + dy) * grid.enlarged.width + x + dx) * 4);
      }
    }
  }
  return { ...grid.enlarged, data };
}

function restoredField(grid: SupportGrid, original: CrackSubPixelField | null): CrackSubPixelField {
  const patched = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= grid.enlarged.width || y >= grid.enlarged.height) return false;
    return (
      grid.restored[
        Math.floor(y / grid.factor) * grid.source.width + Math.floor(x / grid.factor)
      ] === 1
    );
  };
  return {
    lumaAt: (x, y) => {
      if (patched(x, y)) return supportLuma(grid, x, y);
      if (original !== null) return original.lumaAt(x, y);
      if (x < 0 || y < 0 || x >= grid.enlarged.width || y >= grid.enlarged.height) return 255;
      return inkAt(grid.enlarged, y * grid.enlarged.width + x) ? 0 : 255;
    },
    thresholdAt: (x, y) => (patched(x, y) ? 128 : (original?.thresholdAt(x, y) ?? 128)),
  };
}

/** Bilinear sampling of the already accepted native mask, only in restored
 * regions. This adds a consistent support ramp without changing detection
 * settings or replacing the source's other antialiasing gradients. */
function supportLuma(grid: SupportGrid, x: number, y: number): number {
  const sx = (x + 0.5) / grid.factor - 0.5;
  const sy = (y + 0.5) / grid.factor - 0.5;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const sample = (px: number, py: number): number => {
    const xx = Math.max(0, Math.min(grid.source.width - 1, px));
    const yy = Math.max(0, Math.min(grid.source.height - 1, py));
    return inkAt(grid.source, yy * grid.source.width + xx) ? 0 : 255;
  };
  const top = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx;
  const bottom = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx;
  return Math.round(top * (1 - fy) + bottom * fy);
}

function inkAt(image: RawImageData, pixel: number): boolean {
  const offset = pixel * 4;
  if (image.data[offset + 3] === 0) return false;
  return (
    0.299 * (image.data[offset] ?? 255) +
      0.587 * (image.data[offset + 1] ?? 255) +
      0.114 * (image.data[offset + 2] ?? 255) <
    128
  );
}
