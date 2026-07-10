// Framing move builder for GRBL's native jog protocol. Verbatim move shape
// from the pre-ADR-094 ui/state implementation so the refactor stays
// byte-identical: five absolute $J= jogs tracing the job perimeter.

import type { FrameBounds } from '../controller-driver';

export function buildGrblFrameJogLines(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
  const f = Math.max(1, Math.round(feed));
  const fmt = (n: number): string => n.toFixed(3);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.minY },
  ].map((c) => `$J=G90 G21 X${fmt(c.x)} Y${fmt(c.y)} F${f}\n`);
}

// Safe-Z retract jogged before a CNC frame trace, so the bit clears the stock
// before the XY perimeter. Absolute G90 jog, trailing newline — verbatim from
// the pre-ADR-094 ui/state literal so the frame bytes stay byte-identical.
export function buildGrblFrameRetract(zMm: number, feed: number): string {
  return `$J=G90 G21 Z${zMm.toFixed(3)} F${Math.max(1, Math.round(feed))}\n`;
}
