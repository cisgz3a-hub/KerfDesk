import type { CncLayerSettings, CncTool, Polyline } from '../scene';
import { cncLayoutCutWidths } from './layout-cut-widths';
import { pocketRasterToolpaths, pocketRingToolpaths, type PocketToolpaths } from './pocket-paths';
export function pocketToolpathsForSettings(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
): ReadonlyArray<Polyline> {
  return pocketToolpathsForSettingsWithEvidence(polylines, settings, tool).toolpaths;
}

// The wall rides the cut width at the pocket's full depth and the stepover is
// a percentage of the cut width over one depth pass. Both are the stored
// diameter except for a tapered ball nose (ADR-368 Amendment 2).
export function pocketToolpathsForSettingsWithEvidence(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
): PocketToolpaths {
  const widths = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm);
  if (settings.pocketStrategy === 'raster-x' || settings.pocketStrategy === 'raster-y') {
    return pocketRasterToolpaths(
      polylines,
      widths.wallDiameterMm,
      settings.stepoverPercent,
      settings.pocketStrategy === 'raster-x' ? 'x' : 'y',
      widths.clearingDiameterMm,
    );
  }
  return pocketRingToolpaths(
    polylines,
    widths.wallDiameterMm,
    settings.stepoverPercent,
    widths.clearingDiameterMm,
  );
}
