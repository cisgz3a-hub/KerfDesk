// Laser Line tab layouts (ADR-494, LBG-C05): which closed contours take
// automatic tabs, and how a contour splits into burned spans and tab spans once
// its tab centres are known. Built from the same steps as the automatic split
// in tabs-bridges.ts, so tabs placed by count split exactly as they always have.

import type { Polyline, Vec2 } from '../scene';
import {
  burnSegmentsBetweenTabs,
  isTabEligible,
  mergeTabIntervals,
  nearestDistanceOnClosedPolyline,
  sampleTabInterval,
  splitTabInterval,
  tabSplitContext,
  type AutomaticTabsSettings,
  type TabInterval,
  type TabSplitContext,
} from './tabs-bridges';

export type TabSplit = {
  /** What the beam cuts in place of the contour. */
  readonly burns: ReadonlyArray<Polyline>;
  /** The tabs themselves, as open spans in the contour's direction. */
  readonly tabs: ReadonlyArray<Polyline>;
};

/** Tab centres as distances along the loop from its start. `along` projects a
 * point onto the loop and returns its distance. */
export type TabCenters = (
  perimeterMm: number,
  along: (point: Vec2) => number,
) => ReadonlyArray<number>;

const EPS = 1e-9;

/** Per polyline: closed and, when inner shapes are skipped, not a hole. */
export function automaticTabEligibility(
  polylines: ReadonlyArray<Polyline>,
  settings: AutomaticTabsSettings,
): ReadonlyArray<boolean> {
  return polylines.map(
    (polyline, index) => polyline.closed && isTabEligible(polyline, polylines, index, settings),
  );
}

/** `count` centres spread evenly, the first half a gap from the start. */
export function evenTabCenters(count: number): TabCenters {
  return (perimeter) =>
    Array.from({ length: count }, (_unused, index) => ((index + 0.5) * perimeter) / count);
}

/** Null leaves the contour whole: too degenerate for tabs, or no tab on it. */
export function splitClosedPolylineAtTabCenters(
  polyline: Polyline,
  sizeMm: number,
  centers: TabCenters,
): TabSplit | null {
  const context = tabSplitContext(polyline);
  if (context === null) return null;
  // As the automatic split: tabs that swallow the loop keep it all as one
  // bridge rather than cutting the part free.
  if (sizeMm >= context.perimeter) return { burns: [], tabs: [polyline] };
  const half = sizeMm / 2;
  const along = (point: Vec2): number => nearestDistanceOnClosedPolyline(context, point);
  const skips = mergeTabIntervals(
    centers(context.perimeter, along).flatMap((center) =>
      splitTabInterval(center - half, center + half, context.perimeter),
    ),
  );
  if (skips.length === 0) return null;
  return { burns: burnSegmentsBetweenTabs(context, skips), tabs: tabSpans(context, skips) };
}

// A tab across the start point comes out of the interval split as two pieces,
// one ending at the perimeter and one starting at 0. Join them so the tab
// burns as one span.
function tabSpans(
  context: TabSplitContext,
  skips: ReadonlyArray<TabInterval>,
): ReadonlyArray<Polyline> {
  const first = skips[0];
  const last = skips[skips.length - 1];
  const wraps =
    skips.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.start <= EPS &&
    last.end >= context.perimeter - EPS;
  const spans =
    wraps && first !== undefined && last !== undefined
      ? [...skips.slice(1, -1), { start: last.start, end: first.end + context.perimeter }]
      : skips;
  return spans.flatMap((span) => {
    const points = sampleTabInterval(
      context.points,
      context.cumulative,
      context.perimeter,
      span.start,
      span.end,
    );
    return points.length >= 2 ? [{ closed: false, points }] : [];
  });
}
