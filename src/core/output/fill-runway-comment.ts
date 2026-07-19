import { fillOverscanCommentText } from '../job/fill-overscan';
import { feedMatchedFillRunwayMm, usesFeedMatchedFillEntry } from '../job/fill-sweep-plan';
import type { FillGroup } from '../job';

export function fillRunwayCommentText(
  group: FillGroup,
  formatMm: (value: number) => string,
): string {
  const setting = `overscan ${formatMm(group.overscanMm)} mm`;
  if (group.fillRunwayPolicy === 'full') {
    return `${setting} (full feed-matched Island runway where split geometry permits; ADR-235)`;
  }
  if (group.fillRunwayPolicy === 'raster-full') {
    return `${setting} (full feed-matched runway on every raster-model sweep; ADR-235)`;
  }
  if (group.fillRunwayPolicy === 'raster-bounded') {
    return `${setting} (bounded feed-matched raster split runways; ADR-039)`;
  }
  if (!usesFeedMatchedFillEntry(group)) {
    return fillOverscanCommentText(
      group.overscanMm,
      group.fillStyle,
      group.islandMotionPolicy,
      formatMm,
      group.fillRunwayPolicy,
    );
  }
  const appliedMm = feedMatchedFillRunwayMm(group.overscanMm);
  return `overscan ${formatMm(group.overscanMm)} mm (4040 entry runway ${formatMm(appliedMm)} mm at fill feed; ADR-234)`;
}
