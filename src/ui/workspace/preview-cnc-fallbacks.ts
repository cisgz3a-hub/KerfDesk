// CNC operations that cut another strategy or entry than the one they ask for
// (performance audit S8-P2-1). The compile records each on the job; Preview
// names them before anything is saved or started, in the words the Save and
// Start advisories use. Built beside the route, so it crosses from the
// preparation worker in the route's header.

import type { Job, Toolpath } from '../../core/job';
import { cncStrategyFallbackNotice } from '../../core/cnc/cnc-strategy-fallback-notice';
import type { Project } from '../../core/scene';

export type PreviewCncFallbackCarrier = {
  readonly cncFallbackNotices?: ReadonlyArray<string>;
};

export function previewCncFallbackNotices(project: Project, job: Job): ReadonlyArray<string> {
  const sidecar = job.cncCompilation;
  if (sidecar === undefined) return [];
  const layerName = (layerId: string): string =>
    project.scene.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
  return [
    ...(sidecar.strategyFallbacks ?? []).map(
      (fallback) => `${layerName(fallback.layerId)}: ${cncStrategyFallbackNotice(fallback)}`,
    ),
    // The same words as the Save and Start advisory (cnc-preflight.ts).
    ...sidecar.vcarveOperations.flatMap((operation) =>
      operation.entryIssue === null
        ? []
        : [
            `${layerName(operation.layerId)}: ${operation.entryIssue} Set Ramp entry to 0 to remove this notice.`,
          ],
    ),
  ];
}

/** The route with its fallback notices, or the route itself when there are none. */
export function withPreviewCncFallbacks<T extends Toolpath>(
  toolpath: T,
  project: Project,
  job: Job,
): T {
  const notices = previewCncFallbackNotices(project, job);
  return notices.length === 0 ? toolpath : { ...toolpath, cncFallbackNotices: notices };
}

export function previewCncFallbacksOf(toolpath: Toolpath): ReadonlyArray<string> {
  return (toolpath as PreviewCncFallbackCarrier).cncFallbackNotices ?? [];
}
