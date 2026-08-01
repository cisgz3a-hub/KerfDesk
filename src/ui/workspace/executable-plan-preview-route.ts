import type { ExecutablePlanPoint, ExecutablePlanV1 } from '../../core/execution-plan';
import { formatGcodeCoordinateMm } from '../../core/gcode';
import type { JobOriginPlacement, Toolpath, ToolpathStep } from '../../core/job';
import type { DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { emitPreparedGcodeWithExecutablePlan } from '../../io/gcode/executable-plan-emission';
import { mapToolpathToScene } from './preview-scene-frame';

type PreparedSuccess = Extract<PreparedOutput, { readonly ok: true }>;

export type ExecutablePlanPreviewRoute = {
  readonly source: 'executable-plan';
  readonly schema: ExecutablePlanV1['schema'];
  readonly schemaVersion: ExecutablePlanV1['schemaVersion'];
  readonly toolpath: Toolpath;
};

export type ExecutablePlanPreviewCarrier = {
  /**
   * Serialized only when a route crosses the large-job Worker boundary.
   * Ordinary in-process previews keep the association in a WeakMap so the
   * legacy Toolpath shape and its rich CNC/raster metadata stay unchanged.
   */
  readonly executablePlanPreview?: ExecutablePlanPreviewRoute;
};

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
    };

type PreviewRouteSource = ExecutablePlanPreviewRoute['source'] | 'legacy-toolpath';

const executableRouteCache = new WeakMap<Toolpath, ExecutablePlanPreviewRoute>();

/**
 * Builds and associates the plan-backed 2D route only after the emitted plan
 * and the legacy preview agree at the emitter's exact coordinate precision.
 * Any emission, sidecar, or route mismatch retains the old preview.
 */
export function registerExecutablePlanPreviewRoute(args: {
  readonly previewToolpath: Toolpath;
  readonly legacyMachineToolpath: Toolpath;
  readonly prepared: PreparedSuccess;
  readonly jobOrigin?: JobOriginPlacement;
  readonly jobOriginOffset: Vec2;
  readonly device: DeviceProfile;
}): PreviewRouteSource {
  // ADR-243's row provider exists specifically to avoid materializing a full
  // raster. v1 plans retain the exact emitted program, so building one here
  // would defeat that bounded-memory preview path and repeat every streamed
  // row. Keep the existing route until a streaming plan schema exists.
  if (
    args.prepared.job.groups.some(
      (group) => group.kind === 'raster' && group.rowProvider !== undefined,
    )
  ) {
    return 'legacy-toolpath';
  }
  try {
    const emission = emitPreparedGcodeWithExecutablePlan(args.prepared, {
      ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    });
    if (emission.sidecar.kind !== 'ok') return 'legacy-toolpath';
    const planMachineToolpath = buildExecutablePlanPreviewToolpath(emission.sidecar.plan);
    if (!comparePreviewRoutesAtEmitPrecision(args.legacyMachineToolpath, planMachineToolpath).ok) {
      return 'legacy-toolpath';
    }
    executableRouteCache.set(args.previewToolpath, {
      source: 'executable-plan',
      schema: emission.sidecar.plan.schema,
      schemaVersion: emission.sidecar.plan.schemaVersion,
      toolpath: mapToolpathToScene(planMachineToolpath, args.jobOriginOffset, args.device),
    });
    return 'executable-plan';
  } catch {
    // The sidecar is a rollback-preserving preview authority. A failure here
    // must not remove a preview the legacy prepared Job can still construct.
    return 'legacy-toolpath';
  }
}

/** Selects the verified plan route, or the unchanged legacy Toolpath fallback. */
export function previewRouteForDrawing(
  toolpath: Toolpath & ExecutablePlanPreviewCarrier,
): Toolpath {
  return executablePlanPreviewRoute(toolpath)?.toolpath ?? toolpath;
}

/** Exposes the selected authority for focused parity and fallback tests. */
export function previewRouteSource(
  toolpath: Toolpath & ExecutablePlanPreviewCarrier,
): PreviewRouteSource {
  return executablePlanPreviewRoute(toolpath)?.source ?? 'legacy-toolpath';
}

/**
 * Makes the process-local association cloneable for ADR-244's Worker result.
 * The full v1 plan and exact-program carrier are deliberately not copied.
 */
export function serializeExecutablePlanPreviewRoute<
  T extends Toolpath & ExecutablePlanPreviewCarrier,
>(toolpath: T): T {
  const route = executablePlanPreviewRoute(toolpath);
  if (route === undefined || toolpath.executablePlanPreview === route) return toolpath;
  return { ...toolpath, executablePlanPreview: route };
}

function executablePlanPreviewRoute(
  toolpath: Toolpath & ExecutablePlanPreviewCarrier,
): ExecutablePlanPreviewRoute | undefined {
  return executableRouteCache.get(toolpath) ?? toolpath.executablePlanPreview;
}

export function buildExecutablePlanPreviewToolpath(plan: ExecutablePlanV1): Toolpath {
  return {
    steps: plan.motions.flatMap(planMotionSteps),
    totalLength: plan.totals.routeMm,
  };
}

function planMotionSteps(motion: ExecutablePlanV1['motions'][number]): ReadonlyArray<ToolpathStep> {
  const first = motion.pointsMm[0];
  const last = motion.pointsMm.at(-1);
  if (first === undefined || last === undefined) return [];
  if (motion.intent === 'plunge' || motion.intent === 'retract') {
    return [
      {
        kind: 'plunge',
        at: xy(first),
        fromZ: first.z,
        toZ: last.z,
        length: motion.lengthMm,
      },
    ];
  }
  if (motion.intent === 'process') {
    return [
      {
        kind: 'cut',
        // drawPreview uses the theme's process color; this compatibility
        // value is intentionally not a replacement for legacy layer metadata.
        // eslint-disable-next-line no-restricted-syntax -- Required scene-data placeholder, never UI chrome.
        color: '#000000',
        polyline: motion.pointsMm.map(xy),
        length: motion.lengthMm,
        ...zSpan(first, last),
      },
    ];
  }
  const steps: ToolpathStep[] = [];
  for (let index = 1; index < motion.pointsMm.length; index += 1) {
    const from = motion.pointsMm[index - 1];
    const to = motion.pointsMm[index];
    if (from === undefined || to === undefined) continue;
    const length = pointDistance(from, to);
    if (length <= Number.EPSILON) continue;
    steps.push({
      kind: 'travel',
      from: xy(from),
      to: xy(to),
      length,
      motion: motion.mode === 'rapid' ? 'rapid' : 'feed',
      ...zSpan(from, to),
    });
  }
  return steps;
}

function zSpan(
  from: ExecutablePlanPoint,
  to: ExecutablePlanPoint,
): { readonly z?: { readonly from: number; readonly to: number } } {
  return from.z === 0 && to.z === 0 ? {} : { z: { from: from.z, to: to.z } };
}

function xy(point: ExecutablePlanPoint): Vec2 {
  return { x: point.x, y: point.y };
}

function pointDistance(from: ExecutablePlanPoint, to: ExecutablePlanPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

type PreviewRouteSegment = {
  readonly kind: 'process' | 'rapid-travel' | 'feed-travel' | 'vertical';
  readonly from: Vec2;
  readonly to: Vec2;
  readonly fromZ?: number;
  readonly toZ?: number;
};

export function comparePreviewRoutesAtEmitPrecision(
  left: Toolpath,
  right: Toolpath,
): PreviewRouteParityResult {
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

function routeSegments(toolpath: Toolpath): ReadonlyArray<PreviewRouteSegment> {
  return toolpath.steps.flatMap((step) => {
    if (step.kind === 'travel') {
      return [
        {
          kind: step.motion === 'feed' ? ('feed-travel' as const) : ('rapid-travel' as const),
          from: step.from,
          to: step.to,
          ...(step.z === undefined ? {} : { fromZ: step.z.from, toZ: step.z.to }),
        },
      ];
    }
    if (step.kind === 'plunge') {
      return [
        {
          kind: 'vertical' as const,
          from: step.at,
          to: step.at,
          fromZ: step.fromZ,
          toZ: step.toZ,
        },
      ];
    }
    const segments: PreviewRouteSegment[] = [];
    for (let index = 1; index < step.polyline.length; index += 1) {
      const from = step.polyline[index - 1];
      const to = step.polyline[index];
      if (from === undefined || to === undefined) continue;
      segments.push({ kind: 'process', from, to });
    }
    return segments;
  });
}

function sameRouteSegment(left: PreviewRouteSegment, right: PreviewRouteSegment): boolean {
  return (
    left.kind === right.kind &&
    samePointAtEmitPrecision(left.from, right.from) &&
    samePointAtEmitPrecision(left.to, right.to) &&
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
  return `${segment.kind} ${segment.from.x},${segment.from.y}->${segment.to.x},${segment.to.y}${z}`;
}

function samePointAtEmitPrecision(left: Vec2, right: Vec2): boolean {
  return (
    formatGcodeCoordinateMm(left.x) === formatGcodeCoordinateMm(right.x) &&
    formatGcodeCoordinateMm(left.y) === formatGcodeCoordinateMm(right.y)
  );
}

function sameOptionalCoordinate(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return formatGcodeCoordinateMm(left) === formatGcodeCoordinateMm(right);
}
