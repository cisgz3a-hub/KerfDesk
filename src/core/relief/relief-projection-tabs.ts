// Holding tabs on a projected closed loop (rolling audit v11 W6-P2-1; ADR-572
// Amendment 3).
//
// A projected profile follows the relief surface, so its depth changes along
// the loop and the 2D tab splitter (cnc-tabs.ts), which skips whole windows of
// a flat ring, does not apply. Instead each level of the loop is raised to the
// tab top inside evenly spaced windows: a 3D tab. Each window edge is a
// vertical pair at one XY, the wall compiled-tab-rises.ts recognises, so Job
// Review names the tabs the passes really carry. Raising a point only ever
// leaves more material, so a tabbed path never cuts deeper than the checked
// path it came from.
//
// Pure: no clock, no randomness, no I/O.

import type { FinishingPoint } from './relief-finishing-path';

const EPS = 1e-9;

export type ProjectionTabWindows = {
  // Windows per closed loop, spread evenly along its length.
  readonly tabsPerShape: number;
  // Length of each window along the tool centre: the requested tab width
  // plus one bit diameter, as the 2D tabs size their skip windows.
  readonly windowMm: number;
};

export type ProjectionTabbedPath = {
  readonly points: ReadonlyArray<FinishingPoint>;
  // Windows inside which the path really rose to the tab top.
  readonly tabs: number;
};

/** Raise one closed level path to `tabTopZ` inside its tab windows. */
export function withProjectionTabs(
  points: ReadonlyArray<FinishingPoint>,
  tabTopZ: number,
  windows: ProjectionTabWindows,
): ProjectionTabbedPath {
  const lengths = cumulativeLengths(points);
  const perimeter = lengths[lengths.length - 1] ?? 0;
  const count = Math.max(1, Math.floor(windows.tabsPerShape));
  const windowMm = Math.max(0, windows.windowMm);
  if (!(perimeter > EPS) || !(windowMm > EPS)) return { points, tabs: 0 };
  // Windows that swallow the whole loop keep it one bridge, as the 2D tabs do.
  if (count * windowMm >= perimeter - EPS) {
    const rose = points.some((point) => point.z < tabTopZ - EPS);
    return { points: points.map((p) => raised(p, tabTopZ)), tabs: rose ? count : 0 };
  }
  const anchors = Array.from({ length: count }, (_, i) => ((i + 0.5) * perimeter) / count);
  const half = windowMm / 2;
  const layout: TabLayout = {
    tabTopZ,
    inside: (s) => anchors.some((anchor) => circularDistance(s, anchor, perimeter) < half - EPS),
    edges: anchors
      .flatMap((anchor) => [anchor - half, anchor + half])
      .map((s) => ((s % perimeter) + perimeter) % perimeter)
      .sort((a, b) => a - b),
    // Probe just past an edge to learn whether it opens or closes a window:
    // closer than half a window and half the gap between two windows.
    probe: Math.min(half, perimeter / count - windowMm) / 2,
  };
  return {
    points: walled(points, lengths, layout),
    tabs: risenWindows(points, lengths, anchors, half, perimeter, tabTopZ),
  };
}

type TabLayout = {
  readonly tabTopZ: number;
  readonly inside: (s: number) => boolean;
  // Window edges along the loop, ascending in [0, perimeter).
  readonly edges: ReadonlyArray<number>;
  readonly probe: number;
};

// The path with every vertex inside a window raised and a vertical pair at
// each window edge it crosses.
function walled(
  points: ReadonlyArray<FinishingPoint>,
  lengths: ReadonlyArray<number>,
  layout: TabLayout,
): ReadonlyArray<FinishingPoint> {
  const out: FinishingPoint[] = [];
  let edge = 0;
  points.forEach((point, i) => {
    const s = lengths[i] ?? 0;
    const previous = points[i - 1];
    let edgeAtVertex = false;
    // Window edges crossed on the way from the previous vertex to this one.
    while (previous !== undefined && (layout.edges[edge] ?? Number.POSITIVE_INFINITY) <= s + EPS) {
      const at = layout.edges[edge] ?? 0;
      edge += 1;
      out.push(...edgePair(previous, point, lengths[i - 1] ?? 0, s, at, layout));
      edgeAtVertex = Math.abs(at - s) <= EPS;
    }
    // A vertex that sits on an edge is the wall pair just pushed.
    if (!edgeAtVertex) out.push(layout.inside(s) ? raised(point, layout.tabTopZ) : point);
  });
  return out;
}

// The vertical pair at one window edge between two vertices: cut then tab
// where the window opens, tab then cut where it closes.
function edgePair(
  from: FinishingPoint,
  to: FinishingPoint,
  fromS: number,
  toS: number,
  at: number,
  layout: TabLayout,
): readonly [FinishingPoint, FinishingPoint] {
  const span = toS - fromS;
  const t = span > EPS ? Math.min(1, Math.max(0, (at - fromS) / span)) : 1;
  const cut = lerp(from, to, t);
  const tab = raised(cut, layout.tabTopZ);
  return layout.inside(at + layout.probe) ? [cut, tab] : [tab, cut];
}

function raised(point: FinishingPoint, tabTopZ: number): FinishingPoint {
  return point.z < tabTopZ ? { ...point, z: tabTopZ } : point;
}

function risenWindows(
  points: ReadonlyArray<FinishingPoint>,
  lengths: ReadonlyArray<number>,
  anchors: ReadonlyArray<number>,
  half: number,
  perimeter: number,
  tabTopZ: number,
): number {
  let risen = 0;
  for (const anchor of anchors) {
    const rose = points.some((point, i) => {
      const s = lengths[i];
      return (
        s !== undefined &&
        circularDistance(s, anchor, perimeter) < half - EPS &&
        point.z < tabTopZ - EPS
      );
    });
    if (rose) risen += 1;
  }
  return risen;
}

function cumulativeLengths(points: ReadonlyArray<FinishingPoint>): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y);
    out.push(total);
  }
  return out;
}

function circularDistance(s: number, anchor: number, perimeter: number): number {
  const d = Math.abs((((s - anchor) % perimeter) + perimeter) % perimeter);
  return Math.min(d, perimeter - d);
}

function lerp(a: FinishingPoint, b: FinishingPoint, t: number): FinishingPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
