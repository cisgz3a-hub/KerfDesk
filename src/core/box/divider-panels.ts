// divider-panels — divider outlines (wall tabs + egg-crate cross-laps) and
// the matching wall slot cutouts (ADR-116 V2). Tab and slot boundaries are
// computed from the same divider-layout expressions, so the referee's exact
// complementarity checks hold bit-for-bit. X-dividers are notched from the
// top, Y-dividers from the bottom — each takes exactly half the height, so
// the crossing pair fills the full span.

import type { Polyline, Vec2 } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import type { PanelId } from './panel-claims';
import type { PanelRings } from './panel-fit';
import {
  isTabCell,
  junctionCellBounds,
  type DividerLayout,
  type DividerPlacement,
} from './divider-layout';

export function dividerName(placement: DividerPlacement): string {
  return `Divider ${placement.axis.toUpperCase()}${placement.index + 1}`;
}

/**
 * One divider panel's rings in its local frame: u along the divider's long
 * axis (Y-span for X-dividers, X-span for Y-dividers, wall faces included),
 * v from the bottom face upward. No interior cutouts in v2.
 */
export function dividerPanelRings(
  layout: DividerLayout,
  placement: DividerPlacement,
  spec: BoxSpec,
): PanelRings {
  const dims = deriveBoxDims(spec);
  const uSpanMm = placement.axis === 'x' ? dims.outerDepthMm : dims.outerWidthMm;
  const crossSlabs = (placement.axis === 'x' ? layout.yDividers : layout.xDividers).map(
    (cross) => cross.startMm,
  );
  return {
    outline: dividerRing(layout, spec, uSpanMm, crossSlabs, placement.axis),
    cutouts: [],
  };
}

/** Slot cutout rectangles per wall, keyed by the wall panel id. */
export function wallSlotCutouts(
  layout: DividerLayout,
  spec: BoxSpec,
): ReadonlyMap<PanelId, ReadonlyArray<Polyline>> {
  const map = new Map<PanelId, ReadonlyArray<Polyline>>();
  const frontBack = layout.xDividers.flatMap((placement) => slotColumn(layout, spec, placement));
  const leftRight = layout.yDividers.flatMap((placement) => slotColumn(layout, spec, placement));
  if (frontBack.length > 0) {
    map.set('front', frontBack);
    map.set('back', frontBack);
  }
  if (leftRight.length > 0) {
    map.set('left', leftRight);
    map.set('right', leftRight);
  }
  return map;
}

// One divider's slots in a mating wall: the wall's u axis is the box axis
// the divider partitions (x for front/back, y for left/right), and its v is
// z — the junction cell shifted up by the bottom thickness.
function slotColumn(layout: DividerLayout, spec: BoxSpec, placement: DividerPlacement): Polyline[] {
  const slots: Polyline[] = [];
  const u0 = placement.startMm;
  const u1 = placement.startMm + spec.thicknessMm;
  for (let k = 0; k < layout.junction.cellCount; k += 1) {
    if (!isTabCell(k)) continue;
    const cell = junctionCellBounds(layout, k);
    slots.push(rectRing(u0, spec.thicknessMm + cell.fromMm, u1, spec.thicknessMm + cell.toMm));
  }
  return slots;
}

// CCW ring: bottom edge (with cross-lap notches for Y-dividers), right side
// with tab bumps, top edge (with notches for X-dividers), left side with tab
// bumps. Tab cells always start and end with wall-owned even cells, so both
// bottom and top corners sit at u = T on the body line.
function dividerRing(
  layout: DividerLayout,
  spec: BoxSpec,
  uSpanMm: number,
  crossSlabsMm: ReadonlyArray<number>,
  axis: DividerPlacement['axis'],
): Polyline {
  const t = spec.thicknessMm;
  const vSpan = layout.heightSpanMm;
  const lapDepth = vSpan / 2;
  const tabs = tabCells(layout);
  const points: Vec2[] = [];
  // Bottom edge, left to right; Y-dividers carry the bottom cross-laps.
  points.push({ x: t, y: 0 });
  if (axis === 'y') {
    for (const slab of [...crossSlabsMm].sort((a, b) => a - b)) {
      points.push({ x: slab, y: 0 });
      points.push({ x: slab, y: lapDepth });
      points.push({ x: slab + t, y: lapDepth });
      points.push({ x: slab + t, y: 0 });
    }
  }
  points.push({ x: uSpanMm - t, y: 0 });
  // Right side, bottom to top, tab bumps at the odd junction cells.
  for (const cell of tabs) {
    points.push({ x: uSpanMm - t, y: cell.fromMm });
    points.push({ x: uSpanMm, y: cell.fromMm });
    points.push({ x: uSpanMm, y: cell.toMm });
    points.push({ x: uSpanMm - t, y: cell.toMm });
  }
  points.push({ x: uSpanMm - t, y: vSpan });
  // Top edge, right to left; X-dividers carry the top cross-laps.
  if (axis === 'x') {
    for (const slab of [...crossSlabsMm].sort((a, b) => b - a)) {
      points.push({ x: slab + t, y: vSpan });
      points.push({ x: slab + t, y: vSpan - lapDepth });
      points.push({ x: slab, y: vSpan - lapDepth });
      points.push({ x: slab, y: vSpan });
    }
  }
  points.push({ x: t, y: vSpan });
  // Left side, top to bottom, tab bumps mirrored.
  for (const cell of [...tabs].reverse()) {
    points.push({ x: t, y: cell.toMm });
    points.push({ x: 0, y: cell.toMm });
    points.push({ x: 0, y: cell.fromMm });
    points.push({ x: t, y: cell.fromMm });
  }
  points.push({ x: t, y: 0 });
  return { closed: true, points };
}

function tabCells(layout: DividerLayout): ReadonlyArray<{ fromMm: number; toMm: number }> {
  const cells: Array<{ fromMm: number; toMm: number }> = [];
  for (let k = 0; k < layout.junction.cellCount; k += 1) {
    if (isTabCell(k)) cells.push(junctionCellBounds(layout, k));
  }
  return cells;
}

function rectRing(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  };
}
