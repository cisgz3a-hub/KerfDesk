// Framing move builder for GRBL's native jog protocol. The default retains
// the original five absolute jogs; a chosen edge-interior start splits that
// edge while covering the same complete perimeter.

import type { FrameBounds } from '../controller-driver';
import { buildFramePerimeter } from '../../job/frame-perimeter';
import { formatGcodeFeedMmPerMin } from '../../gcode/feed-word';

export function buildGrblFrameJogLines(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
  const f = formatGcodeFeedMmPerMin(feed);
  const fmt = (n: number): string => n.toFixed(3);
  return buildFramePerimeter(bounds, bounds.startPoint).map(
    (c) => `$J=G90 G21 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`,
  );
}

// Safe-Z retract jogged before a CNC frame trace, so the bit clears the stock
// before the XY perimeter. Absolute G90 jog, trailing newline — verbatim from
// the pre-ADR-094 ui/state literal so the frame bytes stay byte-identical.
export function buildGrblFrameRetract(zMm: number, feed: number): string {
  return `$J=G90 G21 Z${zMm.toFixed(3)} F${formatGcodeFeedMmPerMin(feed)}\n`;
}
