import type {
  ExecutablePlanMotionIntent,
  ExecutablePlanPoint,
  ExecutablePlanV1,
} from '../../core/execution-plan';
import type { MotionBlock, MotionManifest } from '../../core/job/motion-manifest';

type ExecutablePlanMotion = ExecutablePlanV1['motions'][number];

export type CanvasPreviewMotion = {
  readonly intent: ExecutablePlanMotionIntent;
  readonly pointsMm: ReadonlyArray<ExecutablePlanPoint>;
  readonly routeStartMm: number;
  readonly routeEndMm: number;
};

export type CanvasPreviewMotionSequence = {
  readonly source: 'executable-plan' | 'legacy-manifest';
  readonly motions: ReadonlyArray<CanvasPreviewMotion>;
  readonly totalRouteMm: number;
};

type CanvasPreviewPlan = {
  readonly manifest: MotionManifest;
};

const sequenceCache = new WeakMap<CanvasPreviewPlan, CanvasPreviewMotionSequence>();
const executablePlanCache = new WeakMap<CanvasPreviewPlan, ExecutablePlanV1>();

/** Associates a verified plan without changing serialized recovery artifacts. */
export function registerCanvasExecutablePlan(
  canvasPlan: CanvasPreviewPlan,
  executablePlan: ExecutablePlanV1,
): void {
  executablePlanCache.set(canvasPlan, executablePlan);
  sequenceCache.delete(canvasPlan);
}

/** Returns the process-local plan associated with a started-job canvas plan. */
export function canvasExecutablePlan(canvasPlan: CanvasPreviewPlan): ExecutablePlanV1 | undefined {
  return executablePlanCache.get(canvasPlan);
}

/**
 * Selects the immutable ExecutablePlan only after exact drawable-route parity.
 * A runtime-seeded legacy manifest can legitimately differ from v1's assumed
 * work-origin basis; that case keeps the existing preview and does not affect
 * the program, preflight, Frame permit, or Start authorization.
 */
export function canvasPreviewMotionSequence(plan: CanvasPreviewPlan): CanvasPreviewMotionSequence {
  const cached = sequenceCache.get(plan);
  if (cached !== undefined) return cached;
  const executablePlan = canvasExecutablePlan(plan);
  const sequence =
    executablePlan !== undefined && previewRouteMatches(executablePlan, plan.manifest)
      ? executableSequence(executablePlan)
      : legacySequence(plan.manifest);
  sequenceCache.set(plan, sequence);
  return sequence;
}

function executableSequence(plan: ExecutablePlanV1): CanvasPreviewMotionSequence {
  return {
    source: 'executable-plan',
    motions: plan.motions,
    totalRouteMm: plan.totals.routeMm,
  };
}

function legacySequence(manifest: MotionManifest): CanvasPreviewMotionSequence {
  return {
    source: 'legacy-manifest',
    motions: manifest.blocks.map((block) => ({
      intent: legacyIntent(block),
      pointsMm: block.points,
      routeStartMm: block.routeStartMm,
      routeEndMm: block.routeEndMm,
    })),
    totalRouteMm: manifest.totalRouteMm,
  };
}

function previewRouteMatches(plan: ExecutablePlanV1, manifest: MotionManifest): boolean {
  if (
    plan.motions.length !== manifest.blocks.length ||
    plan.source.sendableLineCount !== manifest.sendableLineCount ||
    plan.totals.routeMm !== manifest.totalRouteMm
  ) {
    return false;
  }
  return plan.motions.every((motion, index) => {
    const block = manifest.blocks[index];
    return block !== undefined && previewMotionMatches(motion, block);
  });
}

function previewMotionMatches(motion: ExecutablePlanMotion, block: MotionBlock): boolean {
  return (
    motion.rawLineIndex === block.rawLineIndex &&
    motion.sendableLineIndex === block.sendableLineIndex &&
    motion.programLineNumber === block.programLineNumber &&
    legacyCompatibleIntent(motion.intent) === block.kind &&
    motion.lengthMm === block.lengthMm &&
    motion.routeStartMm === block.routeStartMm &&
    motion.routeEndMm === block.routeEndMm &&
    samePoints(motion.pointsMm, block.points)
  );
}

function samePoints(
  left: ReadonlyArray<ExecutablePlanPoint>,
  right: ReadonlyArray<ExecutablePlanPoint>,
): boolean {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        point.x === candidate.x &&
        point.y === candidate.y &&
        point.z === candidate.z
      );
    })
  );
}

function legacyIntent(block: MotionBlock): ExecutablePlanMotionIntent {
  return block.kind;
}

function legacyCompatibleIntent(intent: ExecutablePlanMotionIntent): MotionBlock['kind'] {
  return intent === 'retract' ? 'plunge' : intent;
}
