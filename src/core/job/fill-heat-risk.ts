import { effectiveFillOverscanMm } from './fill-overscan';
import { groupFillSweeps } from './fill-sweeps';
import type { FillGroup, Job } from './job';
import type { Vec2 } from '../scene';

export type FillHeatRiskSummary = {
  readonly islandShortSweepCount: number;
  readonly islandPartialRunwaySweepCount: number;
  readonly islandNoRunwayShortSweepCount: number;
  readonly minIslandSweepMm: number | null;
};

type MutableFillHeatRiskSummary = {
  islandShortSweepCount: number;
  islandPartialRunwaySweepCount: number;
  islandNoRunwayShortSweepCount: number;
  minIslandSweepMm: number | null;
};

export function analyzeFillHeatRisk(job: Job): FillHeatRiskSummary {
  const summary: MutableFillHeatRiskSummary = {
    islandShortSweepCount: 0,
    islandPartialRunwaySweepCount: 0,
    islandNoRunwayShortSweepCount: 0,
    minIslandSweepMm: null,
  };

  for (const group of job.groups) {
    if (!isIslandFillGroup(group)) continue;
    accumulateIslandGroupRisk(summary, group);
  }

  return summary;
}

function isIslandFillGroup(group: Job['groups'][number]): group is FillGroup {
  return group.kind === 'fill' && group.fillStyle === 'island';
}

function accumulateIslandGroupRisk(summary: MutableFillHeatRiskSummary, group: FillGroup): void {
  for (const sweep of groupFillSweeps(group.segments)) {
    const first = sweep.spans[0];
    const last = sweep.spans[sweep.spans.length - 1];
    if (first === undefined || last === undefined) continue;
    const length = Math.hypot(last.end.x - first.start.x, last.end.y - first.start.y);
    if (length <= 0) continue;
    summary.minIslandSweepMm =
      summary.minIslandSweepMm === null ? length : Math.min(summary.minIslandSweepMm, length);
    accumulateShortSweepRisk(summary, group, length, first.start, last.end);
  }
}

function accumulateShortSweepRisk(
  summary: MutableFillHeatRiskSummary,
  group: FillGroup,
  length: number,
  start: Vec2,
  end: Vec2,
): void {
  if (group.overscanMm <= 0 || length >= group.overscanMm * 2) return;
  summary.islandShortSweepCount += 1;
  const effective = effectiveFillOverscanMm([start, end], group.overscanMm, 'island');
  if (effective > 0 && effective < group.overscanMm) {
    summary.islandPartialRunwaySweepCount += 1;
  } else if (effective === 0) {
    summary.islandNoRunwayShortSweepCount += 1;
  }
}
