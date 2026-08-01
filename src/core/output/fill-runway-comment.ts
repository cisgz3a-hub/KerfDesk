import { fillOverscanCommentText } from '../job/fill-overscan';
import {
  feedMatchedFillRunwayMm,
  genericFeedMatchedFillRunwayMm,
  usesFeedMatchedFillRunway,
} from '../job/fill-sweep-plan';
import type { FillGroup } from '../job';

export function fillRunwayCommentText(
  group: FillGroup,
  formatMm: (value: number) => string,
): string {
  const setting = `overscan ${formatMm(group.overscanMm)} mm`;
  if (group.fillRunwayPolicy === 'full') {
    return `${setting} (full feed-matched Island runway where split geometry permits; ADR-236)`;
  }
  if (group.fillRunwayPolicy === 'raster-full') {
    return `${setting} (full feed-matched runway on every raster-model sweep; ADR-236)`;
  }
  if (group.fillRunwayPolicy === 'raster-bounded') {
    return `${setting} (bounded feed-matched raster split runways; ADR-039)`;
  }
  if (group.fillRunwayPolicy === 'feed-matched-every-sweep') {
    const appliedMm = genericFeedMatchedFillRunwayMm(group.overscanMm);
    const fallback =
      group.overscanMm > 0 ? '' : `; generic minimum ${formatMm(appliedMm)} mm applied`;
    return `overscan ${formatMm(group.overscanMm)} mm${fallback} (feed-matched entry and exit up to ${formatMm(appliedMm)} mm on every Scan Line sweep)`;
  }
  if (!usesFeedMatchedFillRunway(group)) {
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
