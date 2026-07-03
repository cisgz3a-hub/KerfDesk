// assembly-referee — the virtual 3D assembly check (ADR-105 verification §1).
// Consumes ONLY the generated outlines plus the spec: panels are mapped into
// box coordinates through the documented drawing convention (re-stated here,
// deliberately not imported), then every cube edge's shared T×T band is
// checked for exact material complementarity and every corner cube for a
// single claimant. Green structural tests are not fit; this is the fit proof.

import type { Polyline } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import type { PanelId } from './panel-claims';

export type RefereePanel = { readonly panel: PanelId; readonly outline: Polyline };

/**
 * playMm > 0 switches the bands to fit-with-clearance mode: material is
 * collected within T/4 of each face line (tab tips recede by play/4), every
 * gap between consecutive tabs must measure play/2 per flank (two flanks per
 * tab ⇒ the ADR-105 contract of play per joint), and interference is never
 * tolerated. toleranceMm covers clipper's 3-decimal rounding.
 */
export type RefereeOptions = { readonly playMm?: number; readonly toleranceMm?: number };

const DEFAULT_PLAY_TOLERANCE_MM = 4e-3;

type Axis = 'x' | 'y' | 'z';
type AxisEnd = 'min' | 'max';
type Interval = { readonly fromMm: number; readonly toMm: number };

// Independent re-statement of the panel drawing convention.
const PLACEMENTS: Readonly<
  Record<PanelId, { uAxis: Axis; vAxis: Axis; normalAxis: Axis; normalEnd: AxisEnd }>
> = {
  bottom: { uAxis: 'x', vAxis: 'y', normalAxis: 'z', normalEnd: 'min' },
  top: { uAxis: 'x', vAxis: 'y', normalAxis: 'z', normalEnd: 'max' },
  front: { uAxis: 'x', vAxis: 'z', normalAxis: 'y', normalEnd: 'min' },
  back: { uAxis: 'x', vAxis: 'z', normalAxis: 'y', normalEnd: 'max' },
  left: { uAxis: 'y', vAxis: 'z', normalAxis: 'x', normalEnd: 'min' },
  right: { uAxis: 'y', vAxis: 'z', normalAxis: 'x', normalEnd: 'max' },
};

/** Empty result = the box assembles: no collisions, no voids, true to size. */
export function checkBoxAssembly(
  panels: ReadonlyArray<RefereePanel>,
  spec: BoxSpec,
  options: RefereeOptions = {},
): ReadonlyArray<string> {
  const spans = outerSpans(spec);
  const playMm = options.playMm ?? 0;
  const toleranceMm = options.toleranceMm ?? DEFAULT_PLAY_TOLERANCE_MM;
  return [
    ...checkEdgeBands(panels, spec.thicknessMm, spans, playMm, toleranceMm),
    ...checkCornerCubes(panels, spec.thicknessMm, spans),
    ...checkAssembledBounds(panels, spans, playMm + toleranceMm),
  ];
}

function outerSpans(spec: BoxSpec): Readonly<Record<Axis, number>> {
  const dims = deriveBoxDims(spec);
  return { x: dims.outerWidthMm, y: dims.outerDepthMm, z: dims.outerHeightMm };
}

// Every pair of present panels with different normal axes shares exactly one
// cube edge; its band interior must be owned by exactly one of the two at
// every position — endpoints compared exactly (shared float expressions).
function checkEdgeBands(
  panels: ReadonlyArray<RefereePanel>,
  thicknessMm: number,
  spans: Readonly<Record<Axis, number>>,
  playMm: number,
  toleranceMm: number,
): string[] {
  const issues: string[] = [];
  for (let i = 0; i < panels.length; i += 1) {
    for (let j = i + 1; j < panels.length; j += 1) {
      const a = panels[i];
      const b = panels[j];
      if (a === undefined || b === undefined) continue;
      if (PLACEMENTS[a.panel].normalAxis === PLACEMENTS[b.panel].normalAxis) continue;
      const edgeAxis = thirdAxis(PLACEMENTS[a.panel].normalAxis, PLACEMENTS[b.panel].normalAxis);
      const label = `${a.panel}/${b.panel}`;
      const merged = [
        ...faceIntervals(a, b.panel, thicknessMm, spans, playMm),
        ...faceIntervals(b, a.panel, thicknessMm, spans, playMm),
      ].sort((p, q) => p.fromMm - q.fromMm);
      issues.push(
        ...(playMm === 0
          ? checkExactPartition(merged, thicknessMm, spans[edgeAxis] - thicknessMm, label)
          : checkPlayPartition(merged, playMm, toleranceMm, label)),
      );
    }
  }
  return issues;
}

// Material intervals of `panel` along the face line it shares with `mate`,
// clipped to the edge interior (corner cubes are judged separately). At
// play 0 the face line is matched exactly (shared float expressions); with
// play, tab tips sit play/4 inside the face, so material within T/4 of the
// face is collected (recess floors at ~T stay far outside the window).
function faceIntervals(
  panel: RefereePanel,
  mate: PanelId,
  thicknessMm: number,
  spans: Readonly<Record<Axis, number>>,
  playMm: number,
): Interval[] {
  const place = PLACEMENTS[panel.panel];
  const matePlace = PLACEMENTS[mate];
  const fixedIsU = matePlace.normalAxis === place.uAxis;
  const fixedSpan = spans[fixedIsU ? place.uAxis : place.vAxis];
  const fixedValue = matePlace.normalEnd === 'min' ? 0 : fixedSpan;
  const windowMm = playMm === 0 ? 0 : thicknessMm / 4;
  const interiorStart = thicknessMm;
  const interiorEnd = spans[fixedIsU ? place.vAxis : place.uAxis] - thicknessMm;
  const out: Interval[] = [];
  const pts = panel.outline.points;
  for (let k = 0; k + 1 < pts.length; k += 1) {
    const p = pts[k];
    const q = pts[k + 1];
    if (p === undefined || q === undefined) continue;
    const interval = bandSegment(p, q, fixedIsU, fixedValue, windowMm, interiorStart, interiorEnd);
    if (interval !== undefined) out.push(interval);
  }
  return out;
}

function bandSegment(
  p: { x: number; y: number },
  q: { x: number; y: number },
  fixedIsU: boolean,
  fixedValue: number,
  windowMm: number,
  interiorStart: number,
  interiorEnd: number,
): Interval | undefined {
  const [pFixed, pVary] = fixedIsU ? [p.x, p.y] : [p.y, p.x];
  const [qFixed, qVary] = fixedIsU ? [q.x, q.y] : [q.y, q.x];
  if (Math.abs(pFixed - fixedValue) > windowMm || Math.abs(qFixed - fixedValue) > windowMm) {
    return undefined;
  }
  const fromMm = Math.max(Math.min(pVary, qVary), interiorStart);
  const toMm = Math.min(Math.max(pVary, qVary), interiorEnd);
  return fromMm < toMm ? { fromMm, toMm } : undefined;
}

function checkExactPartition(
  sorted: ReadonlyArray<Interval>,
  startMm: number,
  endMm: number,
  label: string,
): string[] {
  let cursor = startMm;
  for (const interval of sorted) {
    if (interval.fromMm > cursor) {
      return [`${label}: void in joint at ${cursor}..${interval.fromMm} mm`];
    }
    if (interval.fromMm < cursor) {
      return [`${label}: parts collide at ${interval.fromMm}..${cursor} mm`];
    }
    cursor = interval.toMm;
  }
  if (cursor !== endMm) return [`${label}: void in joint at ${cursor}..${endMm} mm`];
  return [];
}

// With clearance, tabs from the two panels alternate along the band with a
// play/2 gap at every flank (each tab has two flanks ⇒ play per joint).
// Interference is never tolerated; the first/last gaps against the corner
// regions are skipped (the clip boundary hides half of each).
function checkPlayPartition(
  sorted: ReadonlyArray<Interval>,
  playMm: number,
  toleranceMm: number,
  label: string,
): string[] {
  const flankGapMm = playMm / 2;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev === undefined || curr === undefined) continue;
    const gap = curr.fromMm - prev.toMm;
    if (gap < -toleranceMm) {
      return [`${label}: parts interfere by ${-gap} mm at ${curr.fromMm} mm`];
    }
    if (Math.abs(gap - flankGapMm) > toleranceMm) {
      return [
        `${label}: flank gap ${gap} mm at ${prev.toMm} mm; expected ${flankGapMm} ± ${toleranceMm} mm`,
      ];
    }
  }
  return [];
}

// Each corner cube must be filled by exactly one present panel — the classic
// double-claim (collision) / never-claim (hole) failure class.
function checkCornerCubes(
  panels: ReadonlyArray<RefereePanel>,
  thicknessMm: number,
  spans: Readonly<Record<Axis, number>>,
): string[] {
  const issues: string[] = [];
  for (const xEnd of ['min', 'max'] as const) {
    for (const yEnd of ['min', 'max'] as const) {
      for (const zEnd of ['min', 'max'] as const) {
        const ends: Record<Axis, AxisEnd> = { x: xEnd, y: yEnd, z: zEnd };
        const claimants = panels.filter((panel) =>
          panelFillsCorner(panel, ends, thicknessMm, spans),
        );
        if (claimants.length !== 1) {
          issues.push(
            `corner ${xEnd}/${yEnd}/${zEnd}: ${claimants.length} claimants (${claimants
              .map((c) => c.panel)
              .join(', ')})`,
          );
        }
      }
    }
  }
  return issues;
}

function panelFillsCorner(
  panel: RefereePanel,
  ends: Readonly<Record<Axis, AxisEnd>>,
  thicknessMm: number,
  spans: Readonly<Record<Axis, number>>,
): boolean {
  const place = PLACEMENTS[panel.panel];
  if (place.normalEnd !== ends[place.normalAxis]) return false;
  const half = thicknessMm / 2;
  const u = ends[place.uAxis] === 'min' ? half : spans[place.uAxis] - half;
  const v = ends[place.vAxis] === 'min' ? half : spans[place.vAxis] - half;
  return pointInOutline(u, v, panel.outline);
}

function pointInOutline(x: number, y: number, outline: Polyline): boolean {
  const pts = outline.points;
  let inside = false;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const crossesY = a.y > y !== b.y > y;
    if (!crossesY) continue;
    const xAtY = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (x < xAtY) inside = !inside;
  }
  return inside;
}

// The assembled slab-and-outline union must measure the outer box — exactly
// at play 0; within the clearance recession otherwise.
function checkAssembledBounds(
  panels: ReadonlyArray<RefereePanel>,
  spans: Readonly<Record<Axis, number>>,
  slackMm: number,
): string[] {
  const issues: string[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    let minMm = Number.POSITIVE_INFINITY;
    let maxMm = Number.NEGATIVE_INFINITY;
    for (const panel of panels) {
      const extent = panelAxisExtent(panel, axis, spans);
      if (extent === undefined) continue;
      minMm = Math.min(minMm, extent.fromMm);
      maxMm = Math.max(maxMm, extent.toMm);
    }
    const minOk = slackMm === 0 ? minMm === 0 : Math.abs(minMm) <= slackMm;
    const maxOk = slackMm === 0 ? maxMm === spans[axis] : Math.abs(maxMm - spans[axis]) <= slackMm;
    if (!minOk || !maxOk) {
      issues.push(`assembled ${axis} extent ${minMm}..${maxMm} ≠ 0..${spans[axis]} mm`);
    }
  }
  return issues;
}

function panelAxisExtent(
  panel: RefereePanel,
  axis: Axis,
  spans: Readonly<Record<Axis, number>>,
): Interval | undefined {
  const place = PLACEMENTS[panel.panel];
  if (axis === place.normalAxis) {
    return place.normalEnd === 'min'
      ? { fromMm: 0, toMm: 0 }
      : { fromMm: spans[axis], toMm: spans[axis] };
  }
  const useU = axis === place.uAxis;
  let fromMm = Number.POSITIVE_INFINITY;
  let toMm = Number.NEGATIVE_INFINITY;
  for (const point of panel.outline.points) {
    const value = useU ? point.x : point.y;
    fromMm = Math.min(fromMm, value);
    toMm = Math.max(toMm, value);
  }
  return { fromMm, toMm };
}

function thirdAxis(a: Axis, b: Axis): Axis {
  for (const axis of ['x', 'y', 'z'] as const) {
    if (axis !== a && axis !== b) return axis;
  }
  return 'x';
}
