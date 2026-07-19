import { fillOverscanCommentText } from '../job/fill-overscan';
import { feedMatchedFillRunwayMm, usesFeedMatchedFillEntry } from '../job/fill-sweep-plan';
import type { FillGroup } from '../job';

export function fillRunwayCommentText(
  group: FillGroup,
  formatMm: (value: number) => string,
): string {
  if (!usesFeedMatchedFillEntry(group)) {
    return fillOverscanCommentText(
      group.overscanMm,
      group.fillStyle,
      group.islandMotionPolicy,
      formatMm,
    );
  }
  const appliedMm = feedMatchedFillRunwayMm(group.overscanMm);
  return `overscan ${formatMm(group.overscanMm)} mm (4040 entry runway ${formatMm(appliedMm)} mm at fill feed; ADR-234)`;
}
