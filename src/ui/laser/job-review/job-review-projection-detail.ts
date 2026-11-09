// Job Review's line for a relief projection (rolling audit v11 W6-P2-1).
//
// A projected operation cuts its Vertical depth under the relief surface, not
// its Cut depth, so the shape line (pass count from Cut depth, tabs from the
// layer settings) described a program that was never emitted: "3 passes" for
// one, "tabs 4 per shape" for none, and "the 5 mm floor holds the part" for a
// part cut free. This line reads the compiled projection evidence instead:
// the levels cut, the deepest tip, and the tabs the passes really carry.

import { isProfileCutType } from '../../../core/cnc';
import { stockLimitedTabHeightMm } from '../../../core/cnc/cnc-tabs';
import type { Job } from '../../../core/job';
import { DEFAULT_CNC_STOCK, type CncLayerSettings } from '../../../core/scene';
import { formatMm } from './job-review-format';

/** What one operation's compiled projection cut. */
export type CompiledProjectionFacts = {
  readonly verticalDepthMm: number;
  readonly levels: number;
  readonly deepestMm: number;
  readonly closedShapes: number;
  readonly tabbedShapes: number;
  readonly freedShapes: number;
};

/** Compiled projection facts per operation, from the job's planning evidence. */
export function compiledProjectionFactsByLayer(
  job: Job,
): ReadonlyMap<string, CompiledProjectionFacts> {
  const out = new Map<string, CompiledProjectionFacts>();
  for (const plan of job.cncCompilation?.reliefPlans ?? []) {
    if (plan.stage !== 'projection' || plan.projection === undefined) continue;
    const seen = out.get(plan.layerId);
    const facts = { verticalDepthMm: plan.verticalDepthMm ?? 0, ...plan.projection };
    out.set(
      plan.layerId,
      seen === undefined
        ? facts
        : {
            verticalDepthMm: Math.max(seen.verticalDepthMm, facts.verticalDepthMm),
            levels: Math.max(seen.levels, facts.levels),
            deepestMm: Math.max(seen.deepestMm, facts.deepestMm),
            closedShapes: seen.closedShapes + facts.closedShapes,
            tabbedShapes: seen.tabbedShapes + facts.tabbedShapes,
            freedShapes: seen.freedShapes + facts.freedShapes,
          },
    );
  }
  return out;
}

/** The depth and tab parts of a projected operation's detail line. */
export function cncProjectionParts(
  settings: CncLayerSettings,
  facts: CompiledProjectionFacts,
  stockThicknessMm: number | undefined,
): ReadonlyArray<string> {
  const noun = facts.levels === 1 ? 'pass' : 'passes';
  const step =
    facts.levels > 1
      ? ` of up to ${formatMm(Math.min(settings.depthPerPassMm, facts.verticalDepthMm))} mm`
      : '';
  const depth =
    `projected ${formatMm(facts.verticalDepthMm)} mm under the relief surface in ` +
    `${facts.levels} ${noun}${step}, deepest ${formatMm(facts.deepestMm)} mm`;
  return [depth, ...projectionTabsPart(settings, facts, stockThicknessMm)];
}

function projectionTabsPart(
  settings: CncLayerSettings,
  facts: CompiledProjectionFacts,
  stockThicknessMm: number | undefined,
): ReadonlyArray<string> {
  if (!isProfileCutType(settings.cutType) || facts.closedShapes === 0) return [];
  const shapes = (n: number): string => `${n} closed ${n === 1 ? 'shape' : 'shapes'}`;
  if (facts.freedShapes > 0) return [`no holding tab on ${shapes(facts.freedShapes)} cut free`];
  if (!settings.tabsEnabled) return ['tabs off'];
  if (facts.tabbedShapes > 0) {
    const stock = stockThicknessMm ?? DEFAULT_CNC_STOCK.thicknessMm;
    const heightMm =
      stock === DEFAULT_CNC_STOCK.thicknessMm
        ? settings.tabHeightMm
        : stockLimitedTabHeightMm(settings.tabHeightMm, stock);
    const from = stock === DEFAULT_CNC_STOCK.thicknessMm ? 'the cut floor' : 'the stock bottom';
    return [
      `tabs ${settings.tabsPerShape} per shape (${formatMm(settings.tabWidthMm)} × ` +
        `${formatMm(heightMm)} mm above ${from}) on ${facts.tabbedShapes} of ${shapes(facts.closedShapes)}`,
    ];
  }
  if (stockThicknessMm !== undefined && stockThicknessMm > facts.deepestMm) {
    return [
      `tabs skipped: the ${formatMm(stockThicknessMm - facts.deepestMm)} mm floor under the ` +
        'deepest projected cut holds the part',
    ];
  }
  return ['no tabs cut'];
}
