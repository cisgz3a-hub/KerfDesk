import type { Vec3 } from '../geometry/vec3';
import type { CncPass } from '../job';
import type { Polyline, Vec2 } from '../scene';
import { radialEnvelopeSweepRadiiMm, type RadialEnvelope } from './radial-envelope';
import { distinctLoopPoints } from './vcarve-medial-region';
import { representedCncCoordinateMm } from './cnc-output-precision';

export type VCarveSourceBoundaryCoverage = {
  /** Largest uncovered distance at sampled source witnesses; null when no cutting sweep exists. */
  readonly maxSampledResidualMm: number | null;
  readonly sampleCount: number;
  /** False means some boundary witnesses were omitted to keep measurement bounded. */
  readonly samplingComplete: boolean;
};

const MAX_BOUNDARY_WITNESSES = 256;
const MAX_WITNESS_CHORD_PRODUCT = 1_000_000;

/**
 * Measure the final cutter sweep against the source boundary, independently of
 * the sampled-medial reference graph and its compaction certificate. This is a
 * finite witness measurement, not a whole-region coverage or accuracy bound.
 */
export function measureVCarveSourceBoundaryCoverage(
  source: ReadonlyArray<Polyline>,
  passes: ReadonlyArray<CncPass>,
  envelope: RadialEnvelope,
): VCarveSourceBoundaryCoverage {
  const chords = positiveDepthChords(passes);
  const limit = Math.max(
    1,
    Math.min(
      MAX_BOUNDARY_WITNESSES,
      Math.floor(MAX_WITNESS_CHORD_PRODUCT / Math.max(1, chords.length)),
    ),
  );
  const loops = source.map((loop) => distinctLoopPoints(loop.points));
  const vertices = loops.flat();
  const stride = Math.max(1, Math.ceil((vertices.length * 2) / limit));
  const witnesses: Vec2[] = [];
  let visited = 0;
  for (const points of loops) {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      if (visited++ % stride === 0) witnesses.push(a);
      if (visited++ % stride === 0) witnesses.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
  let maxSampledResidualMm = 0;
  for (const point of witnesses) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const [a, b] of chords) {
      const radii = radialEnvelopeSweepRadiiMm(envelope, -a.z, -b.z);
      nearest = Math.min(nearest, sweptDiskDistance(point, a, b, radii[0], radii[1]));
      if (nearest <= 0) break;
    }
    maxSampledResidualMm = Math.max(maxSampledResidualMm, nearest);
  }
  return {
    maxSampledResidualMm: Number.isFinite(maxSampledResidualMm) ? maxSampledResidualMm : null,
    sampleCount: witnesses.length,
    samplingComplete: stride === 1,
  };
}

function positiveDepthChords(passes: ReadonlyArray<CncPass>): Array<readonly [Vec3, Vec3]> {
  const unique = new Map<string, readonly [Vec3, Vec3]>();
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (let i = 1; i < pass.points.length; i += 1) {
      const a = represented(pass.points[i - 1]);
      const b = represented(pass.points[i]);
      if (a === undefined || b === undefined || (a.z >= 0 && b.z >= 0)) continue;
      const ka = `${a.x},${a.y},${a.z}`;
      const kb = `${b.x},${b.y},${b.z}`;
      const key = ka < kb ? `${ka};${kb}` : `${kb};${ka}`;
      unique.set(key, [a, b]);
    }
  }
  return [...unique.values()];
}

function represented(point: Vec3 | undefined): Vec3 | undefined {
  return point === undefined
    ? undefined
    : {
        x: representedCncCoordinateMm(point.x),
        y: representedCncCoordinateMm(point.y),
        z: representedCncCoordinateMm(point.z),
      };
}

function sweptDiskDistance(point: Vec2, a: Vec3, b: Vec3, ra: number, rb: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const dr = rb - ra;
  const value = (t: number) =>
    Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y) - ra - dr * t;
  let minimum = Math.min(value(0), value(1));
  if (lengthSquared > dr * dr) {
    const projection = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
    const perpendicular = Math.hypot(
      a.x + dx * projection - point.x,
      a.y + dy * projection - point.y,
    );
    const t =
      projection + (dr * perpendicular) / Math.sqrt(lengthSquared * (lengthSquared - dr * dr));
    if (t > 0 && t < 1) minimum = Math.min(minimum, value(t));
  }
  return minimum;
}
