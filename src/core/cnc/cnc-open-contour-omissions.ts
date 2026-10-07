import type {
  CncOpenContourOmission,
  CncOpenContourOmissionSource,
} from '../job/cnc-compilation-sidecar-types';
import { DEFAULT_CNC_LAYER_SETTINGS, type Layer } from '../scene';
import { cutTypeNeedsClosedContours } from './closed-contour-cut-types';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';

export type CncOpenContourOmissions = {
  readonly counts: ReadonlyArray<CncOpenContourOmission>;
  readonly sources: ReadonlyArray<CncOpenContourOmissionSource>;
};

/** Record the actual collected contours, without another source scan or closure inference. */
export function cncOpenContourOmissions(
  layer: Layer,
  contours: ReadonlyArray<CollectedCncContour>,
): CncOpenContourOmissions {
  const cutType = (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType;
  if (!cutTypeNeedsClosedContours(cutType)) return { counts: [], sources: [] };
  let count = 0;
  const sourceCounts = new Map<string, number>();
  for (const contour of contours) {
    if (contour.polyline.closed) continue;
    count += 1;
    if (contour.objectId !== undefined)
      sourceCounts.set(contour.objectId, (sourceCounts.get(contour.objectId) ?? 0) + 1);
  }
  return {
    counts: count === 0 ? [] : [{ layerId: layer.id, cutType, count }],
    sources: [...sourceCounts].map(([objectId, sourceCount]) => ({
      layerId: layer.id,
      cutType,
      objectId,
      count: sourceCount,
    })),
  };
}
