import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import type { CncPass } from '../job';
import type { Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';
import { vcarveIncludedAngleDeg } from './vcarve-angle';
import { EMIT_COORDINATE_QUANTUM_MM } from './vcarve-detail-geometry';
import type { DetailDepthLaw } from './vcarve-detail-depth';
import { vcarveEffectiveDepthMm } from './vcarve-depth';
import { orderVCarveMedialRegionPlans, planVCarveMedialRegion } from './vcarve-medial-region-plan';
import { passesForVCarveMedialRegion } from './vcarve-medial-region-passes';
import { vcarveMedialRegionsFromTree } from './vcarve-medial-region';
import { buildVCarveSourceRegionLayout } from './vcarve-region-order';
import type { VCarveLadder, VCarveOptions } from './vcarve-ladder';

const MIN_CLOSED_POINTS = 3;
const MIN_EMITTED_FLOOR_PITCH_MM = 0.001;
const MEDIAL_RAMP_ADVISORY =
  'V-carve medial entry follows its certified variable-depth profile; the requested entry angle was not applied.';

/**
 * Plan one certified variable-depth route set per normalized filled region.
 * Delaunay supplies topology candidates only: exact containment checks decide
 * every accepted XY chord, and emitted-grid depth certification protects the
 * final 0.001 mm XYZ commands against the original normalized boundary.
 */
export function vcarveMedialPasses(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveOptions,
): VCarveLadder {
  const geometry = vcarveGeometry(options);
  if (geometry === null) return NO_MEDIAL_PLAN;
  const source = validClosedSource(polylines);
  const normalized = normalizeClosedPolylineTreeEvenOddChecked(source);
  if (normalized.kind === 'error') return { ...NO_MEDIAL_PLAN, offsetFailed: true };
  const regions = vcarveMedialRegionsFromTree(normalized.value);
  if (regions.length === 0) return NO_MEDIAL_PLAN;
  const sourceLayout = buildVCarveSourceRegionLayout(source);

  const floor = floorSpacing(options.resolutionMm, geometry);
  const plans = orderVCarveMedialRegionPlans(
    regions.map((region, normalizedIndex) =>
      planVCarveMedialRegion(region, sourceLayout, normalizedIndex, {
        maxDepthMm: geometry.maxDepthMm,
        tanHalf: geometry.tanHalf,
        floorPitchMm: floor.pitchMm,
        resolutionMm: options.resolutionMm,
      }),
    ),
  );
  const passes: CncPass[] = [];
  let offsetFailed = false;
  let thinResidual = false;
  let passLimited = floor.unrepresentable;
  const law: DetailDepthLaw = geometry;
  for (const plan of plans) {
    const regionPasses = passesForVCarveMedialRegion(plan, law, options);
    passes.push(...regionPasses.passes);
    offsetFailed = offsetFailed || plan.offsetFailed;
    thinResidual = thinResidual || regionPasses.thinResidual;
    passLimited = passLimited || plan.passLimited || !regionPasses.toleranceMet;
  }

  return {
    passes,
    offsetFailed,
    entryIssue: options.rampAngleDeg === undefined ? null : MEDIAL_RAMP_ADVISORY,
    thinResidual,
    passLimited,
  };
}

function validClosedSource(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
}

function vcarveGeometry(
  options: VCarveOptions,
): { readonly tanHalf: number; readonly maxDepthMm: number } | null {
  const tipAngleDeg = vcarveIncludedAngleDeg(options.tool);
  if (tipAngleDeg === null) return null;
  const tanHalf = Math.tan((tipAngleDeg * Math.PI) / 360);
  const maxDepthMm = vcarveEffectiveDepthMm(options.tool, options.maxDepthMm);
  if (!(tanHalf > 0) || maxDepthMm === null || !(maxDepthMm > 0) || !Number.isFinite(maxDepthMm)) {
    return null;
  }
  return { tanHalf, maxDepthMm };
}

function floorSpacing(
  resolutionMm: number,
  geometry: { readonly tanHalf: number; readonly maxDepthMm: number },
): { readonly pitchMm: number; readonly unrepresentable: boolean } {
  // A path exactly on the flat-core boundary is rounded one Z quantum
  // shallower to remain conservative. Reserve that lost cone radius plus a
  // full XY quantum so adjacent emitted sweeps overlap instead of merely
  // touching in ideal, unrounded geometry.
  const emittedRadiusMm =
    Math.max(0, geometry.maxDepthMm - EMIT_COORDINATE_QUANTUM_MM) * geometry.tanHalf;
  const footprintDiameterMm = Math.max(0, 2 * emittedRadiusMm - 2 * EMIT_COORDINATE_QUANTUM_MM);
  const requestedPitchMm = Math.min(
    0.25,
    resolutionMm > 0 ? resolutionMm : 0.1,
    footprintDiameterMm,
  );
  return {
    pitchMm: Math.max(MIN_EMITTED_FLOOR_PITCH_MM, requestedPitchMm),
    unrepresentable: footprintDiameterMm < MIN_EMITTED_FLOOR_PITCH_MM,
  };
}

const NO_MEDIAL_PLAN: VCarveLadder = {
  passes: [],
  offsetFailed: false,
  entryIssue: null,
  thinResidual: false,
  passLimited: false,
};
