import type { Job } from '../../../core/job';
import { contourEntriesSkipped } from '../../../core/job/contour-entry';
import type { Layer } from '../../../core/scene';
import { layerSubLayerOperationId } from '../../../core/scene/layer';
import { formatMm } from './job-review-format';
import type { JobReviewFact } from './job-review-live-rows';

/** Effective contour-entry facts from the exact compiled Job, not stored policy intent. */
export function buildContourEntryReviewFacts(
  job: Job,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<JobReviewFact> {
  const facts: JobReviewFact[] = [];
  const seen = new Set<string>();
  const skipped = contourEntriesSkipped(job);
  for (const group of job.groups) {
    if (
      group.kind === 'cnc' ||
      group.kind === 'raster' ||
      (group.kind === 'fill' && group.fillStyle !== 'offset') ||
      group.entryRunwayMm === undefined
    ) {
      continue;
    }
    const withExit = group.exitRunwayMm !== undefined;
    const key = `${group.layerId}:${group.entryRunwayMm}:${withExit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = `${withExit ? 'Contour entry and exit' : 'Contour entry'} — ${operationName(group.layerId, layers)}`;
    // ADR-239 Amendment 1: say so when the emitter adds no entry (ADR-343).
    // Amendment 2: an M3 group's exit follows the same rule.
    facts.push(
      skipped
        ? {
            label,
            value: withExit ? SKIPPED_ENTRY_AND_EXIT_VALUE : SKIPPED_ENTRY_VALUE,
            tone: 'warning',
          }
        : {
            label,
            value: `${formatMm(group.entryRunwayMm)} mm effective target at operation feed${withExit ? ', each end' : ''} · laser off`,
            tone: 'default',
          },
    );
  }
  return facts;
}

const SKIPPED_ENTRY_VALUE =
  'Not added · where the bed edges are in program coordinates is unknown, so each contour ' +
  'starts burning from rest';

const SKIPPED_ENTRY_AND_EXIT_VALUE =
  'Not added · where the bed edges are in program coordinates is unknown, so each contour ' +
  'starts burning from rest and slows to a stop at full constant power (M3) at its end; ' +
  'both ends burn darker';

function operationName(layerId: string, layers: ReadonlyArray<Layer>): string {
  const direct = layers.find((layer) => layer.id === layerId);
  if (direct !== undefined) return direct.name;
  for (const layer of layers) {
    const subLayer = layer.subLayers.find(
      (candidate) => layerSubLayerOperationId(layer.id, candidate.id) === layerId,
    );
    if (subLayer !== undefined) return `${layer.name} / ${subLayer.label}`;
  }
  return layerId;
}
