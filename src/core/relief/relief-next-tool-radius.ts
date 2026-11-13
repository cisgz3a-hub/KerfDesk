// The radius a relief's next bit rides with in the band roughing left (CNC
// audit v3 N2-P2-1; ADR-421 Amendment 4).
//
// The reach check decides whether the next bit side-mills the strip roughing
// left beside a wall, or rides with its centre in it, from the bit's radius.
// A tapered ball, V-bit or engraver is stored by its widest cut (a 3.175 mm
// tapered ball with a 1 mm tip), so that radius made it "large" and its tip
// slotted the edge band at full depth. Here a narrowing bit is judged by its
// radius one Depth per pass above its tip: the width it cuts with at the
// depth a level takes, as ADR-368 Amendment 3 lays narrowing bits out by
// their width at depth. Other bits keep their nominal radius.
//
// Pure: no clock, no randomness, no I/O.

import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';

const BISECTIONS = 40;

/** The radius at which `tool` cuts `heightMm` above its tip. */
export function reliefNextToolRadiusMm(tool: CncTool, heightMm: number): number {
  const radius = Math.max(0, tool.diameterMm / 2);
  const narrowing =
    tool.kind === 'tapered-ball-nose' || tool.kind === 'v-bit' || tool.kind === 'engraving';
  if (!narrowing || !(heightMm > 0) || !Number.isFinite(heightMm)) return radius;
  const rise = kernelForTool(tool, Math.max(radius / 50, 1e-3)).surfaceDzAtRadius;
  if (rise(radius) <= heightMm) return radius;
  let low = 0;
  let high = radius;
  for (let i = 0; i < BISECTIONS; i += 1) {
    const mid = (low + high) / 2;
    if (rise(mid) < heightMm) low = mid;
    else high = mid;
  }
  return high;
}
