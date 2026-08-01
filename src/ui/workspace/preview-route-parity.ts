import { formatGcodeCoordinateMm } from '../../core/gcode';
import type { Toolpath, ToolpathStep } from '../../core/job';
import type { Vec2 } from '../../core/scene';

export type PreviewRouteParityResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'segment-count';
      readonly legacyCount: number;
      readonly planCount: number;
      readonly legacySample: ReadonlyArray<string>;
      readonly planSample: ReadonlyArray<string>;
    }
  | {
      readonly ok: false;
      readonly reason: 'segment-mismatch';
      readonly index: number;
      readonly legacy: string;
      readonly plan: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'route-length';
      readonly legacy: string;
      readonly plan: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'cut-step-allocation';
      readonly route: 'legacy' | 'plan';
      readonly stepIndex: number;
      readonly issue: 'insufficient-points' | 'length-mismatch';
      readonly declared: string;
      readonly geometry: string;
    };

type PreviewRouteSegment = {
  readonly kind: 'process' | 'rapid-travel' | 'feed-travel' | 'vertical';
  readonly from: Vec2;
  readonly to: Vec2;
  readonly routeStartMm: number;
  readonly routeEndMm: number;
  readonly fromZ?: number;
  readonly toZ?: number;
};

/**
 * Compares drawable geometry and the cumulative distance assigned to every
 * segment. Matching only aggregate length is insufficient: the scrubber can
 * occupy different XY positions when equal total distance is distributed
 * across the same ordered segments differently.
 */
export function comparePreviewRoutesAtEmitPrecision(
  left: Toolpath,
  right: Toolpath,
): PreviewRouteParityResult {
  const invalidLegacyCut = cutStepAllocationIssue(left);
  if (invalidLegacyCut !== null) {
    return {
      ok: false,
      reason: 'cut-step-allocation',
      route: 'legacy',
      ...invalidLegacyCut,
    };
  }
  const invalidPlanCut = cutStepAllocationIssue(right);
  if (invalidPlanCut !== null) {
    return {
      ok: false,
      reason: 'cut-step-allocation',
      route: 'plan',
      ...invalidPlanCut,
    };
  }
  const leftSegments = routeSegments(left);
  const rightSegments = routeSegments(right);
  if (leftSegments.length !== rightSegments.length) {
    return {
      ok: false,
      reason: 'segment-count',
      legacyCount: leftSegments.length,
      planCount: rightSegments.length,
      legacySample: leftSegments.slice(0, 8).map(routeSegmentText),
      planSample: rightSegments.slice(0, 8).map(routeSegmentText),
    };
  }
  for (let index = 0; index < leftSegments.length; index += 1) {
    const segment = leftSegments[index];
    const candidate = rightSegments[index];
    if (segment === undefined || candidate === undefined || !sameRouteSegment(segment, candidate)) {
      return {
        ok: false,
        reason: 'segment-mismatch',
        index,
        legacy: routeSegmentText(segment),
        plan: routeSegmentText(candidate),
      };
    }
  }
  const legacyLength = formatGcodeCoordinateMm(left.totalLength);
  const planLength = formatGcodeCoordinateMm(right.totalLength);
  if (legacyLength !== planLength) {
    return {
      ok: false,
      reason: 'route-length',
      legacy: legacyLength,
      plan: planLength,
    };
  }
  return { ok: true };
}

function cutStepAllocationIssue(toolpath: Toolpath): {
  readonly stepIndex: number;
  readonly issue: 'insufficient-points' | 'length-mismatch';
  readonly declared: string;
  readonly geometry: string;
} | null {
  for (let stepIndex = 0; stepIndex < toolpath.steps.length; stepIndex += 1) {
    const step = toolpath.steps[stepIndex];
    if (step === undefined || step.kind !== 'cut') continue;
    const declared = formatGcodeCoordinateMm(step.length);
    const geometry = formatGcodeCoordinateMm(polylineLength(step.polyline));
    // A point-only cut has no drawable segment, yet sliceToolpath and the
    // endpoint renderer can still use its point as the route head. Flattening
    // it away would therefore hide a real preview difference.
    if (step.polyline.length < 2) {
      return { stepIndex, issue: 'insufficient-points', declared, geometry };
    }
    // sliceToolpath uses the declared length to select the active step, but
    // geometric distance to truncate a cut polyline. If those disagree, no
    // grouping-independent segment comparison can prove scrubber parity.
    if (declared !== geometry) {
      return { stepIndex, issue: 'length-mismatch', declared, geometry };
    }
  }
  return null;
}

function polylineLength(polyline: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < polyline.length; index += 1) {
    const from = polyline[index - 1];
    const to = polyline[index];
    if (from === undefined || to === undefined) continue;
    length += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return length;
}

function routeSegments(toolpath: Toolpath): ReadonlyArray<PreviewRouteSegment> {
  const segments: PreviewRouteSegment[] = [];
  let routeStartMm = 0;
  for (const step of toolpath.steps) {
    segments.push(...segmentsForStep(step, routeStartMm));
    routeStartMm += step.length;
  }
  return segments;
}

function segmentsForStep(
  step: ToolpathStep,
  routeStartMm: number,
): ReadonlyArray<PreviewRouteSegment> {
  if (step.kind === 'travel') {
    return [
      {
        kind: step.motion === 'feed' ? 'feed-travel' : 'rapid-travel',
        from: step.from,
        to: step.to,
        routeStartMm,
        routeEndMm: routeStartMm + step.length,
        ...(step.z === undefined ? {} : { fromZ: step.z.from, toZ: step.z.to }),
      },
    ];
  }
  if (step.kind === 'plunge') {
    return [
      {
        kind: 'vertical',
        from: step.at,
        to: step.at,
        routeStartMm,
        routeEndMm: routeStartMm + step.length,
        fromZ: step.fromZ,
        toZ: step.toZ,
      },
    ];
  }
  return processSegments(step, routeStartMm);
}

function processSegments(
  step: Extract<ToolpathStep, { readonly kind: 'cut' }>,
  stepRouteStartMm: number,
): ReadonlyArray<PreviewRouteSegment> {
  const segments: PreviewRouteSegment[] = [];
  let routeStartMm = stepRouteStartMm;
  for (let index = 1; index < step.polyline.length; index += 1) {
    const from = step.polyline[index - 1];
    const to = step.polyline[index];
    if (from === undefined || to === undefined) continue;
    const routeEndMm = routeStartMm + Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ kind: 'process', from, to, routeStartMm, routeEndMm });
    routeStartMm = routeEndMm;
  }
  return segments;
}

function sameRouteSegment(left: PreviewRouteSegment, right: PreviewRouteSegment): boolean {
  return (
    left.kind === right.kind &&
    samePointAtEmitPrecision(left.from, right.from) &&
    samePointAtEmitPrecision(left.to, right.to) &&
    sameCoordinateAtEmitPrecision(left.routeStartMm, right.routeStartMm) &&
    sameCoordinateAtEmitPrecision(left.routeEndMm, right.routeEndMm) &&
    sameOptionalCoordinate(left.fromZ, right.fromZ) &&
    sameOptionalCoordinate(left.toZ, right.toZ)
  );
}

function routeSegmentText(segment: PreviewRouteSegment | undefined): string {
  if (segment === undefined) return 'missing';
  const z =
    segment.fromZ === undefined && segment.toZ === undefined
      ? ''
      : ` z:${String(segment.fromZ)}->${String(segment.toZ)}`;
  const route = ` route:${formatGcodeCoordinateMm(segment.routeStartMm)}->${formatGcodeCoordinateMm(segment.routeEndMm)}`;
  return `${segment.kind} ${segment.from.x},${segment.from.y}->${segment.to.x},${segment.to.y}${z}${route}`;
}

function samePointAtEmitPrecision(left: Vec2, right: Vec2): boolean {
  return (
    sameCoordinateAtEmitPrecision(left.x, right.x) && sameCoordinateAtEmitPrecision(left.y, right.y)
  );
}

function sameCoordinateAtEmitPrecision(left: number, right: number): boolean {
  return formatGcodeCoordinateMm(left) === formatGcodeCoordinateMm(right);
}

function sameOptionalCoordinate(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sameCoordinateAtEmitPrecision(left, right);
}
