// Keep-source-order with closed-cut start choices (ADR-385). The operator's
// visiting order and open-path directions stand; only where each closed Line
// cut is entered (and, when asked, its direction) follows the head, starting
// from the same planning seed the reordering planner would use.

import {
  closedCutStartPolicy,
  sequentialClosedCutStarts,
  type ClosedCutStartSettings,
} from './closed-cut-start';
import type { Group } from './job';
import { startCursorForSegments, type SegmentOrderSettings } from './segment-order';

export function sourceOrderWithClosedCutStarts(
  groups: ReadonlyArray<Group>,
  settings: Pick<SegmentOrderSettings, 'startPoint'> & ClosedCutStartSettings,
): ReadonlyArray<Group> {
  const policy = closedCutStartPolicy(settings);
  if (policy === null) return groups;
  return groups.map((group) =>
    group.kind === 'cut'
      ? {
          ...group,
          segments: sequentialClosedCutStarts(
            group.segments,
            startCursorForSegments(group.segments, settings.startPoint),
            policy,
          ),
        }
      : group,
  );
}
