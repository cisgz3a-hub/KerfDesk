// The narrowest bridge a loop's holding tabs leave (ADR-258 Amendments 5 and 7).
//
// A tab window's bridge is the material between the kerf ends either side of
// it: the window's chord less the cut width on a straight span. Where the
// outline closes in on itself, as round an acute tip, the cut running on from
// the other end comes nearer than that end, and the bridge is that distance
// less the cut width (N1-P2-1).
//
// Amendment 7 (CNC audit v3 N7-P3-1): that search walks only the cut beside
// the window, never into the next window, where nothing is cut, and never back
// round to the window's own kerf end, which is the same kerf measured against
// itself. A window whose cut beside it is shorter than the window itself (and
// than two cut widths) is skipped: such a loop is mostly tab, and across a
// small hole the measure read the hole, not the tab (0 mm claimed where the
// emitted program's neck is 3.0-3.7 mm).
//
// Pure: no clock, no randomness, no I/O.

import { type ArcInterval, pointAtDistance, type TabLoop } from './cnc-tab-loop';

const SAMPLES = 24;

/** The narrowest bridge any of `windows` leaves, or null when none is measured. */
export function narrowestBridgeMm(
  loop: TabLoop,
  windows: ReadonlyArray<ArcInterval>,
  cutWidthMm: number,
): number | null {
  let narrowest: number | null = null;
  windows.forEach((window, index) => {
    const arcs = cutArcsBeside(loop, windows, index);
    const shortest = Math.max(2 * cutWidthMm, window.end - window.start);
    if (arcs.after < shortest && arcs.before < shortest) return;
    const bridge = bridgeAcross(loop, window, arcs, cutWidthMm);
    if (narrowest === null || bridge < narrowest) narrowest = bridge;
  });
  return narrowest;
}

type CutArcs = { readonly after: number; readonly before: number; readonly single: boolean };

// The cut running on from each end of window `index` to the next window. With
// one window both are the same cut, round the rest of the loop.
function cutArcsBeside(loop: TabLoop, windows: ReadonlyArray<ArcInterval>, index: number): CutArcs {
  const window = windows[index] as ArcInterval;
  const count = windows.length;
  if (count === 1) {
    const rest = loop.perimeter - (window.end - window.start);
    return { after: rest, before: rest, single: true };
  }
  const next = windows[(index + 1) % count] as ArcInterval;
  const previous = windows[(index - 1 + count) % count] as ArcInterval;
  const nextStart = next.start + (index + 1 === count ? loop.perimeter : 0);
  const previousEnd = previous.end - (index === 0 ? loop.perimeter : 0);
  return {
    after: Math.max(0, nextStart - window.end),
    before: Math.max(0, window.start - previousEnd),
    single: false,
  };
}

function bridgeAcross(
  loop: TabLoop,
  window: ArcInterval,
  arcs: CutArcs,
  cutWidthMm: number,
): number {
  const { start, end } = window;
  const span = Math.max(cutWidthMm, end - start);
  // A point on the cut this close along the loop to the kerf end it is set
  // against is that kerf's own neighbourhood, not a far leg.
  const ownKerf = 2 * cutWidthMm;
  const a = pointAtDistance(loop, start);
  const b = pointAtDistance(loop, end);
  let nearest = Math.hypot(b.x - a.x, b.y - a.y);
  for (let step = 1; step <= SAMPLES; step += 1) {
    const afterAlong = (Math.min(span, arcs.after) * step) / SAMPLES;
    const beforeAlong = (Math.min(span, arcs.before) * step) / SAMPLES;
    // With one window the cut after it runs on round to its own start.
    if (!arcs.single || arcs.after - afterAlong >= ownKerf) {
      const beyondEnd = pointAtDistance(loop, end + afterAlong);
      nearest = Math.min(nearest, Math.hypot(beyondEnd.x - a.x, beyondEnd.y - a.y));
    }
    if (!arcs.single || arcs.before - beforeAlong >= ownKerf) {
      const beforeStart = pointAtDistance(loop, start - beforeAlong);
      nearest = Math.min(nearest, Math.hypot(beforeStart.x - b.x, beforeStart.y - b.y));
    }
  }
  return nearest - cutWidthMm;
}
