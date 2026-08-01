import type { ExecutablePlanPoint, ExecutablePlanV1 } from '../../core/execution-plan';
import type { JobOriginPlacement, Toolpath, ToolpathStep } from '../../core/job';
import type { DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { emitPreparedGcodeWithExecutablePlan } from '../../io/gcode/executable-plan';
import { comparePreviewRoutesAtEmitPrecision } from './preview-route-parity';
import { mapToolpathToScene } from './preview-scene-frame';

export {
  comparePreviewRoutesAtEmitPrecision,
  type PreviewRouteParityResult,
} from './preview-route-parity';

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
  // v1 interprets the emitted program from an assumed work-origin start.
  // Current-position placement has a live runtime basis even when its numeric
  // XY happens to be zero, so coordinate equality cannot prove identity.
  if (args.jobOrigin?.startFrom === 'current-position') return 'legacy-toolpath';
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
