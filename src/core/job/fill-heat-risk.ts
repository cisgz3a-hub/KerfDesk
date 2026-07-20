import { planFillSweeps } from './fill-sweep-plan';
import { isSensitiveIslandFillPolicy } from './island-fill-motion';
import type { FillGroup, Job } from './job';

export type FillHeatRiskSummary = {
  readonly fillSweepCount: number;
  readonly fillFullRunwaySweepCount: number;
  readonly fillPartialRunwaySweepCount: number;
  readonly fillNoRunwaySweepCount: number;
  readonly fillDisabledRunwaySweepCount: number;
  readonly fillRequestedRunwayValuesMm: ReadonlyArray<number>;
  readonly minFillSweepMm: number | null;
  readonly islandShortSweepCount: number;
  readonly sensitiveIslandShortSweepCount: number;
  readonly islandPartialRunwaySweepCount: number;
  readonly islandNoRunwayShortSweepCount: number;
  readonly minIslandSweepMm: number | null;
};

type MutableFillHeatRiskSummary = Omit<
  { -readonly [K in keyof FillHeatRiskSummary]: FillHeatRiskSummary[K] },
  'fillRequestedRunwayValuesMm'
> & { fillRequestedRunwayValuesMm: number[] };

export function analyzeFillHeatRisk(job: Job): FillHeatRiskSummary {
  const summary: MutableFillHeatRiskSummary = {
    fillSweepCount: 0,
    fillFullRunwaySweepCount: 0,
    fillPartialRunwaySweepCount: 0,
    fillNoRunwaySweepCount: 0,
    fillDisabledRunwaySweepCount: 0,
    fillRequestedRunwayValuesMm: [],
    minFillSweepMm: null,
    islandShortSweepCount: 0,
    sensitiveIslandShortSweepCount: 0,
    islandPartialRunwaySweepCount: 0,
    islandNoRunwayShortSweepCount: 0,
    minIslandSweepMm: null,
  };

  for (const group of job.groups) {
    if (group.kind !== 'fill' || (group.fillStyle ?? 'scanline') === 'offset') continue;
    accumulateFillGroupRisk(summary, group);
  }
  return summary;
}

function accumulateFillGroupRisk(summary: MutableFillHeatRiskSummary, group: FillGroup): void {
  const requested = Math.max(0, group.overscanMm);
  if (!summary.fillRequestedRunwayValuesMm.includes(requested)) {
    summary.fillRequestedRunwayValuesMm.push(requested);
    summary.fillRequestedRunwayValuesMm.sort((a, b) => a - b);
  }
  const emittedPasses = Math.max(1, Math.floor(group.passes));
  for (const plan of planFillSweeps(group)) {
    const sweep = plan.sweep;
    const first = sweep.spans[0];
    const last = sweep.spans[sweep.spans.length - 1];
    if (first === undefined || last === undefined) continue;
    const length = Math.hypot(last.end.x - first.start.x, last.end.y - first.start.y);
    if (length <= 0) continue;
    const effective = plan.leadInMm;
    summary.fillSweepCount += emittedPasses;
    summary.minFillSweepMm =
      summary.minFillSweepMm === null ? length : Math.min(summary.minFillSweepMm, length);
    accumulateCoverage(summary, requested, effective, emittedPasses);
    if (group.fillStyle === 'island') {
      accumulateIslandRisk(summary, group, length, effective);
    }
  }
}

function accumulateCoverage(
  summary: MutableFillHeatRiskSummary,
  requested: number,
  effective: number,
  count: number,
): void {
  if (requested <= 0) {
    summary.fillDisabledRunwaySweepCount += count;
  } else if (effective >= requested - 1e-9) {
    summary.fillFullRunwaySweepCount += count;
  } else if (effective > 0) {
    summary.fillPartialRunwaySweepCount += count;
  } else {
    summary.fillNoRunwaySweepCount += count;
  }
}

function accumulateIslandRisk(
  summary: MutableFillHeatRiskSummary,
  group: FillGroup,
  length: number,
  effective: number,
): void {
  summary.minIslandSweepMm =
    summary.minIslandSweepMm === null ? length : Math.min(summary.minIslandSweepMm, length);
  if (group.overscanMm <= 0 || length >= group.overscanMm * 2) return;
  summary.islandShortSweepCount += 1;
  if (isSensitiveIslandFillPolicy(group.islandMotionPolicy)) {
    summary.sensitiveIslandShortSweepCount += 1;
  }
  if (effective > 0 && effective < group.overscanMm) {
    summary.islandPartialRunwaySweepCount += 1;
  } else if (effective === 0) {
    summary.islandNoRunwayShortSweepCount += 1;
  }
}
