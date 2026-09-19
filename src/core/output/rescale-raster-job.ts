import type { Job, RasterGroup } from '../job';
import { rescaleRasterValues } from '../raster/controller-power-scale';

/** Vectors carry percentages; raster rows already carry the source profile's S
 * units. Convert only requested rows without mutating or consuming a provider. */
export function rescaleRasterJob(job: Job, sourceMax: number, targetMax: number): Job {
  if (sourceMax === targetMax) return job;
  return {
    ...job,
    groups: job.groups.map((group) =>
      group.kind === 'raster' ? rescaleRasterGroup(group, sourceMax, targetMax) : group,
    ),
  };
}

function rescaleRasterGroup(group: RasterGroup, sourceMax: number, targetMax: number): RasterGroup {
  return {
    ...group,
    rowProvider: (y) => {
      const row =
        group.rowProvider === undefined
          ? group.sValues.subarray(y * group.pixelWidth, (y + 1) * group.pixelWidth)
          : group.rowProvider(y);
      return rescaleRasterValues(row, sourceMax, targetMax, true);
    },
  };
}
