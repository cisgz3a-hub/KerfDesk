import type { CncPass } from '../job';
import type { CncLayerSettings, Polyline } from '../scene';
import { sourceRegionToolpathBuckets } from './compile-cnc-helpers';
import { planHelicalPocketPasses } from './helical-entry';

export function helicalPocketPassesBySourceRegion(
  settings: CncLayerSettings,
  sourceContours: ReadonlyArray<Polyline>,
  toolpaths: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
): ReadonlyArray<CncPass> | null {
  if (settings.cutType !== 'pocket' || settings.helixEntry === undefined) return null;
  if (settings.pocketStrategy === 'raster-x' || settings.pocketStrategy === 'raster-y') return [];
  const passes: CncPass[] = [];
  for (const bucket of sourceRegionToolpathBuckets(sourceContours, toolpaths)) {
    const plan = planHelicalPocketPasses(bucket, depths, settings.helixEntry);
    if (!plan.ok) return [];
    passes.push(...plan.passes);
  }
  return passes;
}
