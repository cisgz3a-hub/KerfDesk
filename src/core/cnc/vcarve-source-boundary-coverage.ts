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
const PRUNING_ROUNDOFF_SCALE = 64 * Number.EPSILON;

type SweepBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
type PreparedSweep = {
  readonly a: Vec3;
  readonly dx: number;
  readonly dy: number;
  readonly ra: number;
  readonly dr: number;
  readonly lengthSquared: number;
  readonly slopeDenominator: number | null;
  readonly bounds: SweepBounds | null;
};

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
  const chords = positiveDepthChords(passes).map(([a, b]) => prepareSweep(a, b, envelope));
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
    for (const chord of chords) {
      if (outsideSweepReach(point, chord.bounds, nearest)) continue;
      nearest = Math.min(nearest, sweptDiskDistance(point, chord));
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
    // Adjacent chords share an emitted endpoint. Format and model its GRBL
    // representation once, retaining the same rounding and chord replacement order.
    let previous = represented(pass.points[0]);
    for (let i = 1; i < pass.points.length; i += 1) {
      const a = previous;
      const b = represented(pass.points[i]);
      previous = b;
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

function prepareSweep(a: Vec3, b: Vec3, envelope: RadialEnvelope): PreparedSweep {
  const [ra, rb] = radialEnvelopeSweepRadiiMm(envelope, -a.z, -b.z);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const dr = rb - ra;
  const slopeDenominator =
    lengthSquared > dr * dr ? Math.sqrt(lengthSquared * (lengthSquared - dr * dr)) : null;
  const finite = [dx, dy, lengthSquared, dr, slopeDenominator ?? 0].every(Number.isFinite);
  return {
    a,
    dx,
    dy,
    ra,
    dr,
    lengthSquared,
    slopeDenominator,
    // Finite endpoints can still overflow scalar intermediates. Such a chord
    // must reach that same scalar calculation, including its NaN result.
    bounds: finite ? sweepBounds(a, b, ra, rb) : null,
  };
}

function sweepBounds(a: Vec3, b: Vec3, ra: number, rb: number): SweepBounds | null {
  const values = [a.x, a.y, b.x, b.y, ra, rb];
  if (!values.every(Number.isFinite) || ra < 0 || rb < 0) return null;
  // Every affine centre lies in this box and its radius is at most the larger
  // endpoint radius. Inflate for floating arithmetic, then only reject strict
  // separation. Invalid geometry retains the original scalar NaN behaviour.
  const margin = PRUNING_ROUNDOFF_SCALE * Math.max(1, ...values.map(Math.abs));
  const radius = Math.max(ra, rb) + margin;
  return {
    minX: Math.min(a.x, b.x) - radius,
    minY: Math.min(a.y, b.y) - radius,
    maxX: Math.max(a.x, b.x) + radius,
    maxY: Math.max(a.y, b.y) + radius,
  };
}

function outsideSweepReach(point: Vec2, bounds: SweepBounds | null, nearest: number): boolean {
  if (bounds === null) return false;
  const margin =
    PRUNING_ROUNDOFF_SCALE * Math.max(1, Math.abs(point.x), Math.abs(point.y), Math.abs(nearest));
  const reach = nearest + margin;
  // Retain the original chord visitation and early exit. This only skips a
  // solve whose axis distance already exceeds the best complete scalar solve.
  return (
    point.x < bounds.minX - reach ||
    point.x > bounds.maxX + reach ||
    point.y < bounds.minY - reach ||
    point.y > bounds.maxY + reach
  );
}

function sweptDiskDistance(point: Vec2, chord: PreparedSweep): number {
  // These constants belong to the represented chord, not to each source witness.
  // Keep the scalar distance's operation order to retain its exact numeric result.
  const { a, dx, dy, ra, dr, lengthSquared, slopeDenominator } = chord;
  const value = (t: number) =>
    Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y) - ra - dr * t;
  let minimum = Math.min(value(0), value(1));
  if (slopeDenominator !== null) {
    const projection = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
    const perpendicular = Math.hypot(
      a.x + dx * projection - point.x,
      a.y + dy * projection - point.y,
    );
    const t = projection + (dr * perpendicular) / slopeDenominator;
    if (t > 0 && t < 1) minimum = Math.min(minimum, value(t));
  }
  return minimum;
}
