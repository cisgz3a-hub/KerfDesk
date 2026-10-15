import type { DeviceProfile, GrblGcodeDialect } from '../devices';
import type { CutGroup } from '../job';
import { focusTestProfileIssue } from '../job/focus-test';
import { formatGcodeCoordinateMm } from '../gcode';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import {
  emittedHead,
  laserOffMoveLines,
  transitionLinesNow,
  type LaserOutputCursor,
} from './grbl-output-cursor';
import { laserOffSeekLine } from './grbl-laser-lines';
import { vectorPowerWord } from './grbl-power-modes';

type FocusContext = {
  readonly device: DeviceProfile;
  readonly dialect: GrblGcodeDialect;
  readonly cursor: LaserOutputCursor;
};

/** Emit through the ordinary laser pipeline, retaining its exact byte ownership. */
export function emitFocusTestGroup(
  group: CutGroup,
  context: FocusContext,
  emit: () => string,
): string {
  const focus = group.focusTest;
  if (focus === undefined) return emit();
  const issue = focusTestProfileIssue(context.device);
  if (issue !== null) throw new Error(issue);
  if (
    !Number.isFinite(focus.offsetMm) ||
    Math.abs(focus.offsetMm) > 1000 ||
    Number(focus.offsetMm.toFixed(3)) !== focus.offsetMm ||
    !Number.isFinite(focus.travelFeedMmPerMin) ||
    focus.travelFeedMmPerMin <= 0
  )
    throw new Error('Focus Test has unrepresentable Z motion settings.');
  const points = group.segments.flatMap((segment) => segment.polyline);
  const first = points[0];
  if (first === undefined || points.length < 2) return '';
  const { cursor, device, dialect } = context;
  const mode = vectorPowerWord(group, dialect);
  const dark = (): string[] => {
    const target = points.find((point) => {
      const represented = emittedHead(point.x, point.y);
      return represented.x !== cursor.head?.x || represented.y !== cursor.head.y;
    });
    return target === undefined
      ? []
      : laserOffMoveLines(
          cursor,
          emittedHead(target.x, target.y),
          laserOffSeekLine(target.x, target.y, device, dialect),
        );
  };
  const zMove = (offset: number): string[] => {
    const feed = Math.min(focus.travelFeedMmPerMin, device.maxFeed);
    if (!Number.isFinite(feed) || feed <= 0)
      throw new Error('Focus Test requires a positive finite Z travel feed.');
    return offset === 0
      ? []
      : [
          'G91',
          `G1 Z${formatGcodeCoordinateMm(offset)} F${formatGcodeFeedMmPerMin(feed)} S0`,
          'G90',
        ];
  };
  // Never drain a constant-power burn while lit. The dark return remains in
  // the sample's existing XY envelope and is part of the reviewed program.
  const before = [
    `; Focus Test Z offset ${formatGcodeCoordinateMm(focus.offsetMm)} mm from starting focus`,
    ...(cursor.litAtStop ? dark() : []),
    ...laserOffMoveLines(
      cursor,
      emittedHead(first.x, first.y),
      laserOffSeekLine(first.x, first.y, device, dialect),
    ),
    ...transitionLinesNow(cursor, ['M5', ...zMove(focus.offsetMm), `${mode} S0`]),
  ];
  const burn = emit();
  const after = [
    ...dark(),
    ...transitionLinesNow(cursor, ['M5', ...zMove(-focus.offsetMm), `${mode} S0`]),
  ];
  return before.join('\n') + '\n' + burn + after.join('\n') + '\n';
}
