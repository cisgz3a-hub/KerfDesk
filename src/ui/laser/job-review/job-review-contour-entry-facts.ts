import type { Job } from '../../../core/job';
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
  for (const group of job.groups) {
    if (
      group.kind === 'cnc' ||
      group.kind === 'raster' ||
      (group.kind === 'fill' && group.fillStyle !== 'offset') ||
      group.entryRunwayMm === undefined
    ) {
      continue;
    }
    const key = `${group.layerId}:${group.entryRunwayMm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      label: `Contour entry — ${operationName(group.layerId, layers)}`,
      value: `${formatMm(group.entryRunwayMm)} mm effective target at operation feed · laser off`,
      tone: 'default',
    });
  }
  return facts;
}

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
