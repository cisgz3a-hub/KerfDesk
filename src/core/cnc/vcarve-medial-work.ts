import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import { isValidCncTipDiameterMm } from '../cnc-tip-diameter';
import type { CncPass } from '../job';
import type { Polyline, Vec2 } from '../scene';
import { hasFinitePoints } from './profile-paths';
import { vcarveIncludedAngleDeg } from './vcarve-angle';
import { EMIT_COORDINATE_QUANTUM_MM } from './vcarve-detail-geometry';
import type { DetailDepthLaw } from './vcarve-detail-depth';
import { vcarveEffectiveDepthMm } from './vcarve-depth';
import { conicalRadialEnvelope, radialEnvelopeRemovalRadiusMm } from './radial-envelope';
import type { VCarveLadder, VCarveOptions } from './vcarve-ladder';
import {
  planUnrankedVCarveMedialRegion,
  type VCarveMedialRegionGeometryPlan,
} from './vcarve-medial-region-plan';
import { passesForVCarveMedialRegion } from './vcarve-medial-region-passes';
import { vcarveMedialRegionsFromTree, type VCarveMedialRegion } from './vcarve-medial-region';
import {
  buildVCarveSourceRegionLayout,
  vcarveSourceRegionRankFromLayout,
  type VCarveRegionLayout,
} from './vcarve-region-order';

const MIN_CLOSED_POINTS = 3;
const MIN_EMITTED_FLOOR_PITCH_MM = 0.001;
const MEDIAL_RAMP_ADVISORY =
  'V-carve medial entry follows its certified variable-depth profile; the requested entry angle was not applied.';

export type VCarveMedialRegionTask = {
  readonly region: VCarveMedialRegion;
  readonly normalizedIndex: number;
  readonly planOptions: {
    readonly floorPitchMm: number;
    readonly resolutionMm: number;
  };
  readonly law: DetailDepthLaw;
  readonly depthPerPassMm: number;
};

/** Clone-safe region output: no Delaunay graph, segments, or route scratch. */
export type VCarveMedialRegionTaskResult = {
  readonly normalizedIndex: number;
  readonly witness: Vec2 | undefined;
  readonly passes: ReadonlyArray<CncPass>;
  readonly offsetFailed: boolean;
  readonly thinResidual: boolean;
  readonly passLimited: boolean;
};

export type PreparedVCarveMedialWork =
  | { readonly kind: 'complete'; readonly result: VCarveLadder }
  | {
      readonly kind: 'regions';
      readonly tasks: ReadonlyArray<VCarveMedialRegionTask>;
      readonly sourceLayout: VCarveRegionLayout;
      readonly entryIssue: string | null;
      readonly passLimited: boolean;
    };

/** Serial global normalization/discovery. Only the returned tasks may fan out. */
export function prepareVCarveMedialWork(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveOptions,
): PreparedVCarveMedialWork {
  const law = vcarveGeometry(options);
  if (law === null) {
    return complete(
      invalidExplicitTip(options.tool) ? { ...NO_MEDIAL_PLAN, thinResidual: true } : NO_MEDIAL_PLAN,
    );
  }
  const source = validClosedSource(polylines);
  const normalized = normalizeClosedPolylineTreeEvenOddChecked(source);
  if (normalized.kind === 'error') {
    return complete({ ...NO_MEDIAL_PLAN, offsetFailed: true });
  }
  const regions = vcarveMedialRegionsFromTree(normalized.value);
  if (regions.length === 0) return complete(NO_MEDIAL_PLAN);
  const floor = floorSpacing(options.resolutionMm, law);
  const planOptions = {
    floorPitchMm: floor.pitchMm,
    resolutionMm: options.resolutionMm,
  };
  return {
    kind: 'regions',
    tasks: regions.map((region, normalizedIndex) => ({
      region,
      normalizedIndex,
      planOptions,
      law,
      depthPerPassMm: options.depthPerPassMm,
    })),
    sourceLayout: buildVCarveSourceRegionLayout(source),
    entryIssue: options.rampAngleDeg === undefined ? null : MEDIAL_RAMP_ADVISORY,
    passLimited: floor.unrepresentable,
  };
}

export function runVCarveMedialRegionTask(
  task: VCarveMedialRegionTask,
): VCarveMedialRegionTaskResult {
  const unranked = planUnrankedVCarveMedialRegion(task.region, task.normalizedIndex, {
    ...task.planOptions,
    law: task.law,
  });
  const passes = passesForVCarveMedialRegion(unranked.plan, task.law, {
    depthPerPassMm: task.depthPerPassMm,
  });
  return regionTaskResult(unranked.plan, unranked.witness, passes);
}

/** Rank and merge only after every region result has returned. */
export function finalizeVCarveMedialWork(
  work: PreparedVCarveMedialWork,
  results: ReadonlyArray<VCarveMedialRegionTaskResult>,
): VCarveLadder {
  if (work.kind === 'complete') return work.result;
  const ranked = results
    .map((result) => ({
      ...result,
      sourceRank: vcarveSourceRegionRankFromLayout(result.witness, work.sourceLayout),
    }))
    .sort((a, b) => a.sourceRank - b.sourceRank || a.normalizedIndex - b.normalizedIndex);
  return {
    passes: ranked.flatMap((result) => result.passes),
    offsetFailed: ranked.some((result) => result.offsetFailed),
    entryIssue: work.entryIssue,
    thinResidual: ranked.some((result) => result.thinResidual),
    passLimited: work.passLimited || ranked.some((result) => result.passLimited),
  };
}

function regionTaskResult(
  plan: VCarveMedialRegionGeometryPlan,
  witness: Vec2 | undefined,
  passes: ReturnType<typeof passesForVCarveMedialRegion>,
): VCarveMedialRegionTaskResult {
  return {
    normalizedIndex: plan.normalizedIndex,
    witness,
    passes: passes.passes,
    offsetFailed: plan.offsetFailed,
    thinResidual: passes.thinResidual,
    passLimited: plan.passLimited || !passes.toleranceMet,
  };
}

function validClosedSource(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
}

function vcarveGeometry(options: VCarveOptions): DetailDepthLaw | null {
  const tipAngleDeg = vcarveIncludedAngleDeg(options.tool);
  if (tipAngleDeg === null) return null;
  const envelope = conicalRadialEnvelope(options.tool, tipAngleDeg);
  const maxDepthMm = vcarveEffectiveDepthMm(options.tool, options.maxDepthMm);
  if (
    envelope === null ||
    maxDepthMm === null ||
    !(maxDepthMm > 0) ||
    !Number.isFinite(maxDepthMm)
  ) {
    return null;
  }
  return { ...envelope, maxDepthMm };
}

function floorSpacing(
  resolutionMm: number,
  geometry: DetailDepthLaw,
): { readonly pitchMm: number; readonly unrepresentable: boolean } {
  // A path exactly on the flat-core boundary is rounded one Z quantum
  // shallower to remain conservative. Reserve that lost cone radius plus a
  // full XY quantum so adjacent emitted sweeps overlap instead of merely
  // touching in ideal, unrounded geometry.
  const emittedRadiusMm = radialEnvelopeRemovalRadiusMm(
    geometry,
    Math.max(0, geometry.maxDepthMm - EMIT_COORDINATE_QUANTUM_MM),
  );
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

function complete(result: VCarveLadder): PreparedVCarveMedialWork {
  return { kind: 'complete', result };
}

const NO_MEDIAL_PLAN: VCarveLadder = {
  passes: [],
  offsetFailed: false,
  entryIssue: null,
  thinResidual: false,
  passLimited: false,
};

function invalidExplicitTip(tool: VCarveOptions['tool']): boolean {
  return (
    tool.kind === 'engraving' &&
    tool.tipDiameterMm !== undefined &&
    !isValidCncTipDiameterMm(tool.tipDiameterMm, tool.diameterMm)
  );
}
