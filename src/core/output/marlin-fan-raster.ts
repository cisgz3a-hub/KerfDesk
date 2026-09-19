import type { Job } from '../job';
import { MARLIN_FAN_MAX_POWER } from '../raster/controller-power-scale';
import { rescaleRasterJob } from './rescale-raster-job';

export { MARLIN_FAN_MAX_POWER };

/** Convert already-compiled raster S values to fan units without copying a full image. */
export function marlinFanRasterJob(job: Job, sourceMaxPowerS: number): Job {
  return rescaleRasterJob(job, sourceMaxPowerS, MARLIN_FAN_MAX_POWER);
}
