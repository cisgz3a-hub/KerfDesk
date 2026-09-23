import { analyzeFillHeatRisk, type Job, type ScanOffsetPoint } from '../../../core/job';

// The review model is built when Job Review opens and rebuilt at Confirm from
// the same immutable compile; replanning every fill sweep cost ~0.2 s of that
// Confirm on a dense fill (ADR-352).
const fillHeatRiskByJob = new WeakMap<
  Job,
  WeakMap<ReadonlyArray<ScanOffsetPoint>, ReturnType<typeof analyzeFillHeatRisk>>
>();

export function memoizedFillHeatRisk(
  job: Job,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): ReturnType<typeof analyzeFillHeatRisk> {
  let byOffsets = fillHeatRiskByJob.get(job);
  if (byOffsets === undefined) {
    byOffsets = new WeakMap();
    fillHeatRiskByJob.set(job, byOffsets);
  }
  const cached = byOffsets.get(scanningOffsets);
  if (cached !== undefined) return cached;
  const coverage = analyzeFillHeatRisk(job, scanningOffsets);
  byOffsets.set(scanningOffsets, coverage);
  return coverage;
}
