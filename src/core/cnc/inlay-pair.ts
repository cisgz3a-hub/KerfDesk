import { offsetClosedPolylinesWithRoundJoins } from '../geometry/kerf-offset';
import type { CncLayerSettings, CncTool, Polyline, Vec2 } from '../scene';
import { pocketRingToolpaths } from './pocket-paths';
import { hasFinitePoints, profileToolpathPolylines } from './profile-paths';

const MIN_CLOSED_POINTS = 3;

export type StraightInlayPairOptions = {
  readonly toolDiameterMm: number;
  readonly allowanceMm: number;
  readonly pairSpacingMm: number;
  readonly stepoverPercent: number;
  readonly pairDirectionX?: 1 | -1;
};

export type StraightInlayPairPlanningEvidence = {
  readonly femalePocketOffsetFailed: boolean;
  readonly femalePocketPassLimited: boolean;
  readonly stepoverUsed: boolean;
};

export type StraightInlayPairPlan =
  | ({ readonly ok: false; readonly reason: string } & StraightInlayPairPlanningEvidence)
  | ({
      readonly ok: true;
      readonly femaleToolpaths: ReadonlyArray<Polyline>;
      readonly maleToolpaths: ReadonlyArray<Polyline>;
      readonly femaleContours: ReadonlyArray<Polyline>;
      readonly maleContours: ReadonlyArray<Polyline>;
    } & StraightInlayPairPlanningEvidence);

const NO_INLAY_PLANNING_EVIDENCE: StraightInlayPairPlanningEvidence = {
  femalePocketOffsetFailed: false,
  femalePocketPassLimited: false,
  stepoverUsed: false,
};

export function planStraightInlayPairForSettings(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  pairDirectionX: 1 | -1 = 1,
): StraightInlayPairPlan {
  if (settings.cutType !== 'inlay-pair') return failure('The layer is not an inlay pair.');
  if (tool.kind !== 'end-mill') return failure('Inlay pairs require an end mill.');
  return planStraightInlayPair(polylines, {
    toolDiameterMm: tool.diameterMm,
    allowanceMm: settings.inlayAllowanceMm ?? 0.1,
    pairSpacingMm: settings.inlayPairSpacingMm ?? 10,
    stepoverPercent: settings.stepoverPercent,
    pairDirectionX,
  });
}

export function straightInlayPocketDepthMm(settings: CncLayerSettings): number {
  return settings.inlayPocketDepthMm ?? Math.min(3, settings.depthMm);
}

// A single linked plan keeps both halves on the same finish tool. Opening the
// design by the tool radius gives the male and female the same machinable corner
// radii; the allowance then expands the pocket and contracts the insert by half
// each, producing the requested per-side clearance.
export function planStraightInlayPair(
  polylines: ReadonlyArray<Polyline>,
  options: StraightInlayPairOptions,
): StraightInlayPairPlan {
  const closed = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  if (closed.length === 0) return failure('Inlay pairs require at least one closed contour.');
  const optionIssue = inlayOptionIssue(options);
  if (optionIssue !== null) return failure(optionIssue);

  const radius = options.toolDiameterMm / 2;
  // Unchecked, deliberately — no checked round-joins sibling was added. The
  // closed filter above already drops non-finite points (the documented
  // clipper trigger), so the error arm has no reachable input. Even if it
  // fired, the reason would not reach an operator: compileStraightInlayOperation
  // discards StraightInlayPairPlan.reason and returns null
  // (inlay-pair-operation.ts), and nothing in src/ui calls
  // planStraightInlayPairForSettings — the resulting empty layer is caught only
  // as a dropped layer by findDroppedCncLayers. A checked variant would just
  // make a string nobody reads more accurate; route the reason to Job Review
  // first, then converting is worth it.
  const opened = offsetClosedPolylinesWithRoundJoins(
    offsetClosedPolylinesWithRoundJoins(closed, -radius),
    radius,
  );
  if (opened.length === 0) {
    return failure('The selected bit cannot reproduce this design after corner compensation.');
  }

  const halfAllowance = options.allowanceMm / 2;
  const femaleContours = offsetOrIdentity(opened, halfAllowance);
  const maleBase = offsetOrIdentity(opened, -halfAllowance);
  if (femaleContours.length === 0 || maleBase.length === 0) {
    return failure('The fit allowance removes geometry from one half of the inlay.');
  }
  const maleContours = placeMirroredToPhysicalRight(
    femaleContours,
    maleBase,
    options.pairSpacingMm,
    options.pairDirectionX ?? 1,
  );
  const femalePocket = pocketRingToolpaths(
    femaleContours,
    options.toolDiameterMm,
    options.stepoverPercent,
  );
  const femaleToolpaths = femalePocket.toolpaths;
  const maleToolpaths = profileToolpathPolylines(maleContours, 'outside', options.toolDiameterMm);
  const pocketEvidence: StraightInlayPairPlanningEvidence = {
    femalePocketOffsetFailed: femalePocket.offsetFailed,
    femalePocketPassLimited: femalePocket.passLimited,
    stepoverUsed: femalePocket.stepoverUsed,
  };
  if (femaleToolpaths.length === 0)
    return failure('The selected bit does not fit the inlay pocket.', pocketEvidence);
  if (maleToolpaths.length === 0)
    return failure('The insert profile could not be generated.', pocketEvidence);
  return {
    ok: true,
    femaleToolpaths,
    maleToolpaths,
    femaleContours,
    maleContours,
    ...pocketEvidence,
  };
}

function inlayOptionIssue(options: StraightInlayPairOptions): string | null {
  if (!(options.toolDiameterMm > 0) || !Number.isFinite(options.toolDiameterMm)) {
    return 'Inlay pairs require a positive end-mill diameter.';
  }
  if (!(options.allowanceMm >= 0) || !Number.isFinite(options.allowanceMm)) {
    return 'Inlay fit allowance must be zero or greater.';
  }
  return options.pairSpacingMm > 0 && Number.isFinite(options.pairSpacingMm)
    ? null
    : 'Inlay pair spacing must be positive.';
}

function offsetOrIdentity(
  polylines: ReadonlyArray<Polyline>,
  offsetMm: number,
): ReadonlyArray<Polyline> {
  return offsetMm === 0 ? polylines : offsetClosedPolylinesWithRoundJoins(polylines, offsetMm);
}

function placeMirroredToPhysicalRight(
  female: ReadonlyArray<Polyline>,
  male: ReadonlyArray<Polyline>,
  spacingMm: number,
  pairDirectionX: 1 | -1,
): ReadonlyArray<Polyline> {
  const femaleBounds = boundsOf(female);
  const maleBounds = boundsOf(male);
  if (femaleBounds === null || maleBounds === null) return [];
  const mirrorAxisX = (maleBounds.minX + maleBounds.maxX) / 2;
  const shiftX =
    pairDirectionX === 1
      ? femaleBounds.maxX + spacingMm - maleBounds.minX
      : femaleBounds.minX - spacingMm - maleBounds.maxX;
  return male.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => ({
      x: mirrorAxisX * 2 - point.x + shiftX,
      y: point.y,
    })),
  }));
}

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function boundsOf(polylines: ReadonlyArray<Polyline>): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of polylines) {
    for (const point of polyline.points) includePoint(point);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;

  function includePoint(point: Vec2): void {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
}

function failure(
  reason: string,
  evidence: StraightInlayPairPlanningEvidence = NO_INLAY_PLANNING_EVIDENCE,
): StraightInlayPairPlan {
  return { ok: false, reason, ...evidence };
}
