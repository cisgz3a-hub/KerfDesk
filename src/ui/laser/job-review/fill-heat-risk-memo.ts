import {
  analyzeFillHeatRisk,
  type FillHeatRiskSummary,
  type Job,
  type ScanOffsetPoint,
} from '../../../core/job';

export type FillHeatRisk = FillHeatRiskSummary;

// The review model is built when Job Review opens and rebuilt at Confirm from
// the same immutable compile; replanning every fill sweep cost ~0.2 s of that
// Confirm on a dense fill (ADR-352). Keyed by the offsets' value, not their
// array, so the analysis the preparation worker already made can seed it
// (start-preparation-wire.ts, ADR-598 Amendment 4).
const fillHeatRiskByJob = new WeakMap<Job, Map<string, FillHeatRisk>>();

export function memoizedFillHeatRisk(
  job: Job,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): FillHeatRisk {
  const byOffsets = offsetsFor(job);
  const key = JSON.stringify(scanningOffsets);
  const cached = byOffsets.get(key);
  if (cached !== undefined) return cached;
  const coverage = analyzeFillHeatRisk(job, scanningOffsets);
  byOffsets.set(key, coverage);
  return coverage;
}

/** Record the analysis of this exact job, made where the job was compiled. */
export function seedFillHeatRisk(
  job: Job,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
  risk: FillHeatRisk,
): void {
  offsetsFor(job).set(JSON.stringify(scanningOffsets), risk);
}

function offsetsFor(job: Job): Map<string, FillHeatRisk> {
  let byOffsets = fillHeatRiskByJob.get(job);
  if (byOffsets === undefined) {
    byOffsets = new Map();
    fillHeatRiskByJob.set(job, byOffsets);
  }
  return byOffsets;
}
