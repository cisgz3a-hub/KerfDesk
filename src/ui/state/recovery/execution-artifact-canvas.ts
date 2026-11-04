import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { MotionBlockColumns, type MotionManifest } from '../../../core/job/motion-manifest';
import { runWorkSteps, type WorkSteps } from '../../../core/recovery/work-steps';
import type { ExecutionArtifactV1 } from './execution-artifact';
import { canvasExecutablePlan, registerCanvasExecutablePlan } from '../canvas-preview-motion';
import {
  hasColumnPackedEncoding,
  hasPackedMotionEncoding,
  isArchivedPackedMotionManifest,
  isArchivedPackedMotionManifestSteps,
  packMotionManifestSteps,
  unpackMotionManifest,
  unpackTrustedMotionManifest,
  type ArchivedPackedMotionManifest,
  type PackMotionManifestOptions,
} from './packed-motion-manifest';

const PACK_MANIFEST_MINIMUM_BLOCKS = 4_096;
const PACK_MANIFEST_MINIMUM_POINTS = PACK_MANIFEST_MINIMUM_BLOCKS * 2;

export type ArchivedCanvasMotionPlan =
  | CanvasMotionPlan
  | (Omit<CanvasMotionPlan, 'manifest'> & {
      readonly manifest: ArchivedPackedMotionManifest;
    });

const hydratedPlans = new WeakMap<ArchivedCanvasMotionPlan, CanvasMotionPlan>();

/** Archive every exact path point without object-per-point storage overhead.
 *
 * `enforceArchiveBudget: false` packs the same bytes for a caller that is not
 * writing an archive — the worker-to-main Start handoff (ADR-345) and the
 * recovery preview. Only a real archive may be refused for its size; a job the
 * operator can otherwise run must never become unpreparable because its
 * manifest is large (ADR-241/243/244). */
export function archiveCanvasMotionPlan(
  plan: CanvasMotionPlan,
  options: PackMotionManifestOptions = {},
): ArchivedCanvasMotionPlan {
  return runWorkSteps(archiveCanvasMotionPlanSteps(plan, options));
}

export function* archiveCanvasMotionPlanSteps(
  plan: CanvasMotionPlan,
  options: PackMotionManifestOptions = {},
): WorkSteps<ArchivedCanvasMotionPlan> {
  if (plan.manifest === undefined) return plan;
  if (manifestNeedsCompaction(plan.manifest)) {
    return { ...plan, manifest: yield* packMotionManifestSteps(plan.manifest, options) };
  }
  // Minimal fixtures and small plans keep plain blocks, as before columns: a
  // structured clone would strip the columns' class (ADR-244 Amendment 3).
  if (!(plan.manifest.blocks instanceof MotionBlockColumns)) return plan;
  const plain = {
    ...plan,
    manifest: { ...plan.manifest, blocks: Array.from(plan.manifest.blocks) },
  };
  // The same program, so a verified plan this thread associated stays with it.
  const executable = canvasExecutablePlan(plan);
  if (executable !== undefined) registerCanvasExecutablePlan(plain, executable);
  return plain;
}

function manifestNeedsCompaction(manifest: MotionManifest): boolean {
  if (manifest.blocks.length >= PACK_MANIFEST_MINIMUM_BLOCKS) return true;
  // A G2/G3 source line can contain hundreds of sampled points. Count actual
  // geometry as well as source movements, stopping as soon as it is large.
  let points = 0;
  for (const block of manifest.blocks) {
    points += block.points.length;
    if (points >= PACK_MANIFEST_MINIMUM_POINTS) return true;
  }
  return false;
}

/** Hydrate only the selected archive, keeping repository history compact and
 * returning a stable plan during canvas zoom, selection, and recovery review. */
export function executionArtifactCanvasPlan(
  artifact: Pick<ExecutionArtifactV1, 'canvasPlan'>,
): CanvasMotionPlan {
  const plan = artifact.canvasPlan;
  if (!hasPackedMotionEncoding(plan.manifest)) return plan as CanvasMotionPlan;
  const cached = hydratedPlans.get(plan);
  if (cached !== undefined) return cached;
  if (!isArchivedPackedMotionManifest(plan.manifest))
    throw new Error('The archived motion manifest is invalid.');
  const hydrated = { ...plan, manifest: unpackMotionManifest(plan.manifest) };
  hydratedPlans.set(plan, hydrated);
  return hydrated;
}

export function isArchivedCanvasMotionPlan(
  value: unknown,
  rawLines: number,
  sendableLines: number,
): value is ArchivedCanvasMotionPlan {
  return runWorkSteps(isArchivedCanvasMotionPlanSteps(value, rawLines, sendableLines));
}

export function* isArchivedCanvasMotionPlanSteps(
  value: unknown,
  rawLines: number,
  sendableLines: number,
): WorkSteps<boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const manifest = (value as Record<string, unknown>)['manifest'];
  if (!hasPackedMotionEncoding(manifest)) {
    // Keep historical plain manifests compatible, but do not mistake a packed
    // payload with a missing encoding tag for a plain manifest.
    return (
      manifest === undefined ||
      (typeof manifest === 'object' &&
        manifest !== null &&
        Array.isArray((manifest as Record<string, unknown>)['blocks']))
    );
  }
  return yield* isArchivedPackedMotionManifestSteps(manifest, { rawLines, sendableLines });
}

/** The Start handoff from the preparation worker (ADR-345): its columns are
 * wrapped, not validated or copied. Archives use `executionArtifactCanvasPlan`. */
export function transferredCanvasMotionPlan(plan: ArchivedCanvasMotionPlan): CanvasMotionPlan {
  if (!hasPackedMotionEncoding(plan.manifest)) return plan as CanvasMotionPlan;
  if (!hasColumnPackedEncoding(plan.manifest)) {
    return executionArtifactCanvasPlan({ canvasPlan: plan });
  }
  return { ...plan, manifest: unpackTrustedMotionManifest(plan.manifest) };
}
