import { reliefMachineSpacePlanningWidthMm } from '../../core/cnc/relief-machine-space-planning-width';
import type { HeightfieldHeightmapOptions } from '../../core/relief/heightfield-to-heightmap';
import type { HeightfieldReliefObject, ReliefHeightfield } from '../../core/scene/relief';

/** Canonical cache request for one canvas heightfield preview. */
export type DrawReliefHeightfieldPreviewRequest = {
  readonly source: ReliefHeightfield;
  readonly cacheKey: string;
  readonly reliefDepthMm: number;
  readonly options: HeightfieldHeightmapOptions;
};

/** Build one canonical request identity for the 2D heightfield preview cache. */
export function drawReliefHeightfieldPreviewRequest(
  relief: HeightfieldReliefObject,
  displayCellsAcross: number,
): DrawReliefHeightfieldPreviewRequest {
  const widthMm = reliefMachineSpacePlanningWidthMm(relief);
  const heightMm = relief.reliefSource.physicalHeightMm;
  const mmPerCell = Math.max(widthMm, heightMm) / displayCellsAcross;
  return {
    source: relief.reliefSource,
    cacheKey: `${widthMm}:${relief.reliefDepthMm}:${mmPerCell}`,
    reliefDepthMm: relief.reliefDepthMm,
    options: {
      targetWidthMm: widthMm,
      reliefDepthMm: relief.reliefDepthMm,
      mmPerCell,
    },
  };
}
