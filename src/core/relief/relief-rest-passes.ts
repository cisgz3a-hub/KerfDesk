import type { CncPass } from '../job';
import type { Heightmap } from './heightmap';
import type { FinishingPoint } from './relief-finishing-path';

const MAX_FILTER_POINTS = 1_000_000;
/** Retain pieces of contact-checked moves whose footprint can meet remaining stock.
 * Subdivision preserves each original G1 exactly, including its lifted mask paths.
 */
export function reliefRestPasses(
  map: Heightmap,
  passes: ReadonlyArray<CncPass>,
  selected: Uint8Array,
  cutterRadiusMm: number,
): { readonly passes: ReadonlyArray<CncPass>; readonly fallbackReason?: string } {
  if (filterPoints(map, passes) > MAX_FILTER_POINTS)
    return {
      passes,
      fallbackReason: 'Rest path selection exceeded its work budget; full fine finishing retained.',
    };
  const reach = Math.ceil(cutterRadiusMm / map.mmPerCell) + 2;
  const footprint = rectangularDilation(selected, map.widthCells, map.heightCells, reach);
  const out: CncPass[] = [];
  for (const pass of passes) {
    if (pass.kind !== 'path3d') {
      out.push(pass);
      continue;
    }
    let run: FinishingPoint[] = [];
    const flush = (): void => {
      if (run.length > 1) out.push({ ...pass, points: run, closed: false });
      run = [];
    };
    for (let index = 1; index < pass.points.length; index += 1) {
      const a = pass.points[index - 1],
        b = pass.points[index];
      if (a === undefined || b === undefined) continue;
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (map.mmPerCell / 2)));
      for (let k = 1; k <= count; k += 1) {
        const from = pointAt(a, b, (k - 1) / count),
          to = pointAt(a, b, k / count);
        if (selectedAt(map, footprint, from) || selectedAt(map, footprint, to)) {
          if (run.length === 0) run.push(from);
          run.push(to);
        } else flush();
      }
    }
    flush();
  }
  return { passes: out };
}

function filterPoints(map: Heightmap, passes: ReadonlyArray<CncPass>): number {
  let count = 0;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (let i = 1; i < pass.points.length; i += 1) {
      const a = pass.points[i - 1],
        b = pass.points[i];
      if (a !== undefined && b !== undefined)
        count += Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (map.mmPerCell / 2)));
    }
  }
  return count;
}
function selectedAt(map: Heightmap, mask: Uint8Array, p: FinishingPoint): boolean {
  const col = Math.max(0, Math.min(map.widthCells - 1, Math.floor(p.x / map.mmPerCell)));
  const row = Math.max(0, Math.min(map.heightCells - 1, Math.floor(p.y / map.mmPerCell)));
  return mask[row * map.widthCells + col] === 1;
}
function pointAt(a: FinishingPoint, b: FinishingPoint, t: number): FinishingPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
function rectangularDilation(
  mask: Uint8Array,
  width: number,
  height: number,
  reach: number,
): Uint8Array {
  const row = new Uint8Array(mask.length),
    out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1)
    slidingWindow(
      width,
      reach,
      (x) => mask[y * width + x] ?? 0,
      (x, value) => {
        row[y * width + x] = value;
      },
    );
  for (let x = 0; x < width; x += 1)
    slidingWindow(
      height,
      reach,
      (y) => row[y * width + x] ?? 0,
      (y, value) => {
        out[y * width + x] = value;
      },
    );
  return out;
}
function slidingWindow(
  size: number,
  reach: number,
  read: (index: number) => number,
  write: (index: number, value: number) => void,
): void {
  let count = 0;
  for (let i = 0; i <= Math.min(size - 1, reach); i += 1) count += read(i);
  for (let i = 0; i < size; i += 1) {
    write(i, count > 0 ? 1 : 0);
    if (i - reach >= 0) count -= read(i - reach);
    if (i + reach + 1 < size) count += read(i + reach + 1);
  }
}
