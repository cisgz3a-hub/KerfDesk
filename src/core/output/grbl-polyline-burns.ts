// The lit G1 chain of one contour segment for the GRBL laser emitter, moved
// out of grbl-strategy.ts with ADR-127 Amendment 2, which gave each move of a
// scaled rotary job its own surface-matched feed.

import type { GrblGcodeDialect } from '../devices';
import type { CutSegment } from '../job';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { formatGcodePowerS } from '../gcode/decimal-word';
import { emittedHead, type EmittedHead } from './grbl-output-cursor';
import type { LaserPowerScaleVersion } from './laser-power-scale-version';
import { surfaceMatchedFeed, type RotaryFeedMatch } from './rotary-surface-feed';

export type SegmentBurns = {
  readonly lines: ReadonlyArray<string>;
  readonly end: EmittedHead;
  /** Where the first emitted burn goes (it starts at the segment's first point). */
  readonly firstTarget: { readonly x: number; readonly y: number };
};

export type PolylineBurnContext = {
  readonly laserPowerScaleVersion: LaserPowerScaleVersion;
  readonly s: number;
  readonly feed: number;
  readonly dialect: GrblGcodeDialect;
  /** ADR-127 Amd 2: present on a scaled rotary job; each move's F is matched. */
  readonly rotaryFeed?: RotaryFeedMatch | undefined;
};

export function polylineSegmentBurns(
  seg: CutSegment,
  first: { readonly x: number; readonly y: number },
  context: PolylineBurnContext,
): SegmentBurns | null {
  const { s, feed, dialect } = context;
  const lines: string[] = [];
  let head = emittedHead(first.x, first.y);
  let firstTarget: SegmentBurns['firstTarget'] | null = null;
  let lastFeedWord = '';
  for (let i = 1; i < seg.polyline.length; i += 1) {
    const pt = seg.polyline[i];
    if (pt === undefined) continue;
    const target = emittedHead(pt.x, pt.y);
    // Formatting is part of the executable artifact: points that differ in
    // memory can collapse to one machine coordinate at 3 dp. Never emit a
    // stationary positive-power G1, and keep F/S for the first real move.
    if (target.x === head.x && target.y === head.y) continue;
    const burnEmitted = firstTarget !== null;
    // ADR-127 Amd 2: on a scaled rotary F follows each move's direction, from
    // the coordinates the controller reads. Elsewhere it is the layer feed.
    const moveFeed = surfaceMatchedFeed(
      feed,
      numericHead(head),
      numericHead(target),
      context.rotaryFeed,
    );
    const moveFeedWord = ` F${formatGcodeFeedMmPerMin(moveFeed)}`;
    const feedWord =
      !burnEmitted || !dialect.modalFeedrate || moveFeedWord !== lastFeedWord ? moveFeedWord : '';
    lastFeedWord = moveFeedWord;
    const sWord =
      !burnEmitted || dialect.emitSOnEveryBurnMove
        ? ` S${formatGcodePowerS(s, context.laserPowerScaleVersion)}`
        : '';
    lines.push(`G1 X${target.x} Y${target.y}${feedWord}${sWord}`);
    firstTarget ??= pt;
    head = target;
  }
  return firstTarget === null ? null : { lines, end: head, firstTarget };
}

function numericHead(head: EmittedHead): { readonly x: number; readonly y: number } {
  return { x: Number(head.x), y: Number(head.y) };
}
