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
): ReadonlyArray<string> {
  const spans = outerSpans(spec);
  return [
    ...checkEdgeBands(panels, spec.thicknessMm, spans),
    ...checkCornerCubes(panels, spec.thicknessMm, spans),
    ...checkAssembledBounds(panels, spans),
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
        ...faceIntervals(a, b.panel, thicknessMm, spans),
        ...faceIntervals(b, a.panel, thicknessMm, spans),
      ].sort((p, q) => p.fromMm - q.fromMm);
      issues.push(...checkPartition(merged, thicknessMm, spans[edgeAxis] - thicknessMm, label));
    }
  }
  return issues;
}

// Material intervals of `panel` along the face line it shares with `mate`,
// clipped to the edge interior (corner cubes are judged separately).
function faceIntervals(
  panel: RefereePanel,
  mate: PanelId,
  thicknessMm: number,
  spans: Readonly<Record<Axis, number>>,
): Interval[] {
  const place = PLACEMENTS[panel.panel];
  const matePlace = PLACEMENTS[mate];
  const fixedIsU = matePlace.normalAxis === place.uAxis;
  const fixedSpan = spans[fixedIsU ? place.uAxis : place.vAxis];
  const fixedValue = matePlace.normalEnd === 'min' ? 0 : fixedSpan;
  const interiorStart = thicknessMm;
  const interiorEnd = spans[fixedIsU ? place.vAxis : place.uAxis] - thicknessMm;
  const out: Interval[] = [];
  const pts = panel.outline.points;
  for (let k = 0; k + 1 < pts.length; k += 1) {
    const p = pts[k];
    const q = pts[k + 1];
    if (p === undefined || q === undefined) continue;
    const [pFixed, pVary] = fixedIsU ? [p.x, p.y] : [p.y, p.x];
    const [qFixed, qVary] = fixedIsU ? [q.x, q.y] : [q.y, q.x];
    if (pFixed !== fixedValue || qFixed !== fixedValue) continue;
    const fromMm = Math.max(Math.min(pVary, qVary), interiorStart);
    const toMm = Math.min(Math.max(pVary, qVary), interiorEnd);
    if (fromMm < toMm) out.push({ fromMm, toMm });
  }
  return out;
}

function checkPartition(
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

// The assembled slab-and-outline union must measure exactly the outer box.
function checkAssembledBounds(
  panels: ReadonlyArray<RefereePanel>,
  spans: Readonly<Record<Axis, number>>,
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
    if (minMm !== 0 || maxMm !== spans[axis]) {
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
