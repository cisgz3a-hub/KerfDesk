// The planner size of the controller a sealed run streamed to: what CNC pass
// recovery reserves (OR-2) and what a laser restart steps back over when the
// stop left no status report of the backlog (ADR-398 Decision 2).

import { DEFAULT_PLANNER_BLOCKS } from '../../../core/motion-planner/controller-planner-blocks';
import type { ExecutionArtifactV1 } from './execution-artifact';
import { maxOf } from '../../../core/util';

/** The usable planner size the run's controller reported, when the run kept
 * it: the session's idle `Bf` blocks free, and the stock `$I` OPT block count
 * observed in the same session. The larger one bounds the rewind (OR-2). */
export function recordedPlannerBlocks(artifact: ExecutionArtifactV1): number | undefined {
  const idle = artifact.archivedControllerObservation.plannerBlocksAtIdle ?? undefined;
  const controller = artifact.provenance?.controller;
  const buildInfo = controller?.buildInfo;
  const fromBuildInfo =
    buildInfo?.observation.sessionEpoch === controller?.sessionEpoch
      ? buildInfo?.parsed?.plannerBufferBlocks
      : undefined;
  const recorded = [idle, fromBuildInfo].filter(
    (blocks): blocks is number => blocks !== undefined && Number.isFinite(blocks) && blocks > 0,
  );
  return recorded.length === 0 ? undefined : maxOf(recorded);
}

/** The run's planner size: as recorded, else its controller family's default.
 * Undefined for a controller KerfDesk never streams. */
export function runPlannerBlocks(artifact: ExecutionArtifactV1): number | undefined {
  return recordedPlannerBlocks(artifact) ?? DEFAULT_PLANNER_BLOCKS[artifact.controller.kind];
}
