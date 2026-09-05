import type { Job, RasterGroup } from '../job';

export const MARLIN_FAN_MAX_POWER = 255;

/** Convert already-compiled raster S values to fan units without copying a full image. */
export function marlinFanRasterJob(job: Job, sourceMaxPowerS: number): Job {
  if (sourceMaxPowerS === MARLIN_FAN_MAX_POWER) return job;
  return {
    ...job,
    groups: job.groups.map((group) =>
      group.kind === 'raster' ? fanRasterGroup(group, sourceMaxPowerS) : group,
    ),
  };
}

function fanRasterGroup(group: RasterGroup, sourceMaxPowerS: number): RasterGroup {
  // Vector groups still carry percentages, but raster arrays/providers already
  // carry the original device's S units. Convert each requested source row once;
  // preserve provider ordering and never mutate or eagerly consume its storage.
  return {
    ...group,
    rowProvider: (y) => {
      const row =
        group.rowProvider === undefined
          ? group.sValues.subarray(y * group.pixelWidth, (y + 1) * group.pixelWidth)
          : group.rowProvider(y);
      return Float64Array.from(row, (value) =>
        Math.round((value / sourceMaxPowerS) * MARLIN_FAN_MAX_POWER),
      );
    },
  };
}
