import type { GcodeRenderModel } from '../../core/gcode-view';
import type { MotionBlock, MotionManifest, MotionPoint } from '../../core/job/motion-manifest';
import type { PlayheadState } from './playhead';

/** Map confirmed physical route through its raw source line, not total time or ACKs.
 * Runtime-seeded approach moves can differ from a file's assumed initial zero;
 * those moves deliberately have no overlay until the geometries agree. */
export function inspectorPlayheadAtRoute(
  model: GcodeRenderModel,
  manifest: MotionManifest,
  routeMm: number,
): PlayheadState | null {
  if (!Number.isFinite(routeMm) || manifest.blocks.length === 0) return null;
  const route = Math.max(0, Math.min(routeMm, manifest.totalRouteMm));
  const block = blockAtRoute(manifest, route);
  if (block === undefined) return null;
  const first = firstSegmentAtLine(model, block.rawLineIndex);
  if (!blockMatchesModel(model, block, first)) return null;
  let remaining = Math.max(0, route - block.routeStartMm);
  for (let index = 1; index < block.points.length; index += 1) {
    const from = block.points[index - 1];
    const to = block.points[index];
    if (from === undefined || to === undefined) return null;
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (remaining <= length || index === block.points.length - 1) {
      const fraction = length <= 0 ? 1 : Math.min(1, remaining / length);
      return {
        routeMm: route,
        segmentIndex: first + index - 1,
        segmentFraction: fraction,
        point: {
          x: from.x + (to.x - from.x) * fraction,
          y: from.y + (to.y - from.y) * fraction,
          z: from.z + (to.z - from.z) * fraction,
        },
      };
    }
    remaining -= length;
  }
  return null;
}

function blockAtRoute(manifest: MotionManifest, route: number): MotionBlock | undefined {
  let low = 0;
  let high = manifest.blocks.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((manifest.blocks[middle]?.routeEndMm ?? 0) < route) low = middle + 1;
    else high = middle;
  }
  return manifest.blocks[low];
}

function firstSegmentAtLine(model: GcodeRenderModel, line: number): number {
  let low = 0;
  let high = model.segmentCount;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((model.segLine[middle] ?? 0) < line) low = middle + 1;
    else high = middle;
  }
  return low;
}

function blockMatchesModel(model: GcodeRenderModel, block: MotionBlock, first: number): boolean {
  const count = block.points.length - 1;
  if (count <= 0 || first + count > model.segmentCount) return false;
  for (let offset = 0; offset < count; offset += 1) {
    const segment = first + offset;
    if (model.segLine[segment] !== block.rawLineIndex) return false;
    if (!pointMatches(model.positions, segment * 6, block.points[offset])) return false;
    if (!pointMatches(model.positions, segment * 6 + 3, block.points[offset + 1])) return false;
  }
  return model.segLine[first + count] !== block.rawLineIndex;
}

function pointMatches(positions: Float32Array, offset: number, point?: MotionPoint): boolean {
  if (point === undefined) return false;
  // The render model stores Float32 while the started manifest keeps doubles.
  const tolerance = Math.max(0.0001, Math.abs(point.x) * 1e-6, Math.abs(point.y) * 1e-6);
  return (
    Math.abs((positions[offset] ?? NaN) - point.x) <= tolerance &&
    Math.abs((positions[offset + 1] ?? NaN) - point.y) <= tolerance &&
    Math.abs((positions[offset + 2] ?? NaN) - point.z) <=
      Math.max(tolerance, Math.abs(point.z) * 1e-6)
  );
}
