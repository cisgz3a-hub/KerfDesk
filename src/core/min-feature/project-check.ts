// Minimum-feature check over a whole project or one fresh trace (ADR-408).
// One work budget covers every checked operation, so a job with many cutting
// layers is bounded as a whole; operations left when it runs out are reported
// as unchecked rather than silently passed.

import type { Project } from '../scene';
import { DEFAULT_MIN_FEATURE_BUDGET, type MinFeatureBudget } from './feature-budget';
import { analyzeMinimumFeatures, type MinFeatureAnalysis } from './min-feature-analysis';
import { minFeatureTargets, type MinFeatureTarget } from './operation-targets';

export type MinFeatureReport = Omit<MinFeatureTarget, 'paths'> & {
  readonly analysis: MinFeatureAnalysis;
};

const UNCHECKED: MinFeatureAnalysis = {
  widths: { count: 0, minWidthMm: null, sites: [] },
  gaps: { count: 0, minWidthMm: null, sites: [] },
  complete: false,
  work: { pieces: 0, pairTests: 0 },
};

export function checkProjectMinimumFeatures(
  project: Project,
  options: { readonly objectIds?: ReadonlySet<string>; readonly budget?: MinFeatureBudget } = {},
): ReadonlyArray<MinFeatureReport> {
  const remaining = { ...(options.budget ?? DEFAULT_MIN_FEATURE_BUDGET) };
  return minFeatureTargets(project, options.objectIds).map(({ paths, ...target }) => {
    if (remaining.maxPieces <= 0 || remaining.maxPairTests <= 0) {
      return { ...target, analysis: UNCHECKED };
    }
    const analysis = analyzeMinimumFeatures(paths, target.request, remaining);
    remaining.maxPieces -= analysis.work.pieces;
    remaining.maxPairTests -= analysis.work.pairTests;
    return { ...target, analysis };
  });
}
