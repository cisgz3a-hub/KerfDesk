// panel-claims — assigns every edge cell and every T×T×T corner cube of the
// box to exactly one panel (ADR-105). Each of the 12 cube edges gets ONE
// shared alternating sequence (edge-pattern); each of the 8 corner cubes goes
// to the highest-priority present panel, Z > Y > X. Both mating panels read
// the same pattern object, so their claims are complementary by construction
// and land on bit-identical float boundaries.
//
// Panel drawing convention (the assembly referee re-states this
// independently — keep the two in sync ONLY by re-deriving from the box
// geometry, never by importing):
//   bottom/top: u=x, v=y   front/back: u=x, v=z   left/right: u=y, v=z
// Slabs: bottom z∈[0,T], top z∈[OH−T,OH], front y∈[0,T], back y∈[OD−T,OD],
// left x∈[0,T], right x∈[OW−T,OW].

import { cellBoundary, edgePattern, primaryOwnsCell, type EdgePattern } from './edge-pattern';
import { deriveBoxDims, type BoxSpec } from './box-spec';

export type PanelId = 'bottom' | 'top' | 'front' | 'back' | 'left' | 'right';
export type SideId = 'vMin' | 'uMax' | 'vMax' | 'uMin';
type Axis = 'x' | 'y' | 'z';
type AxisEnd = 'min' | 'max';

export type SideInterval = {
  readonly fromMm: number;
  readonly toMm: number;
  readonly owned: boolean;
};

export type PanelClaims = {
  readonly panel: PanelId;
  readonly sizeUMm: number;
  readonly sizeVMm: number;
  readonly thicknessMm: number;
  /**
   * Per side, ascending in the side's local axis coordinate, covering
   * [0, side length] exactly: start-corner region, interior cells (or one
   * fully-owned interval when the side has no mate), end-corner region.
   */
  readonly sides: Readonly<Record<SideId, ReadonlyArray<SideInterval>>>;
};

const PANEL_ORDER: ReadonlyArray<PanelId> = ['bottom', 'top', 'front', 'back', 'left', 'right'];

type PanelDef = {
  readonly uAxis: Axis;
  readonly vAxis: Axis;
  readonly normalAxis: Axis;
  readonly normalEnd: AxisEnd;
  readonly mates: Readonly<Record<SideId, PanelId>>;
};

const PANEL_DEFS: Readonly<Record<PanelId, PanelDef>> = {
  bottom: horizontalPanel('min'),
  top: horizontalPanel('max'),
  front: uprightXPanel('min'),
  back: uprightXPanel('max'),
  left: uprightYPanel('min'),
  right: uprightYPanel('max'),
};

function horizontalPanel(normalEnd: AxisEnd): PanelDef {
  return {
    uAxis: 'x',
    vAxis: 'y',
    normalAxis: 'z',
    normalEnd,
    mates: { vMin: 'front', vMax: 'back', uMin: 'left', uMax: 'right' },
  };
}

function uprightXPanel(normalEnd: AxisEnd): PanelDef {
  return {
    uAxis: 'x',
    vAxis: 'z',
    normalAxis: 'y',
    normalEnd,
    mates: { vMin: 'bottom', vMax: 'top', uMin: 'left', uMax: 'right' },
  };
}

function uprightYPanel(normalEnd: AxisEnd): PanelDef {
  return {
    uAxis: 'y',
    vAxis: 'z',
    normalAxis: 'x',
    normalEnd,
    mates: { vMin: 'bottom', vMax: 'top', uMin: 'front', uMax: 'back' },
  };
}

// Z panels beat Y panels beat X panels when three meet at a corner cube.
const AXIS_PRIORITY: Readonly<Record<Axis, number>> = { z: 0, y: 1, x: 2 };

/** Build claims for every present panel, in stable PANEL_ORDER. */
export function buildPanelClaims(spec: BoxSpec): ReadonlyArray<PanelClaims> {
  const dims = deriveBoxDims(spec);
  const spanByAxis: Readonly<Record<Axis, number>> = {
    x: dims.outerWidthMm,
    y: dims.outerDepthMm,
    z: dims.outerHeightMm,
  };
  const patternByAxis: Readonly<Record<Axis, EdgePattern>> = {
    x: axisPattern(spec, spanByAxis.x),
    y: axisPattern(spec, spanByAxis.y),
    z: axisPattern(spec, spanByAxis.z),
  };
  const present = new Set<PanelId>(
    PANEL_ORDER.filter((panel) => spec.style === 'closed' || panel !== 'top'),
  );
  return [...present].map((panel) =>
    claimsForPanel(panel, present, spanByAxis, patternByAxis, spec.thicknessMm),
  );
}

function claimsForPanel(
  panel: PanelId,
  present: ReadonlySet<PanelId>,
  spanByAxis: Readonly<Record<Axis, number>>,
  patternByAxis: Readonly<Record<Axis, EdgePattern>>,
  thicknessMm: number,
): PanelClaims {
  const def = PANEL_DEFS[panel];
  const sides = Object.fromEntries(
    (['vMin', 'uMax', 'vMax', 'uMin'] as const).map((side) => [
      side,
      sideIntervals(panel, side, present, spanByAxis, patternByAxis, thicknessMm),
    ]),
  ) as Record<SideId, ReadonlyArray<SideInterval>>;
  return {
    panel,
    sizeUMm: spanByAxis[def.uAxis],
    sizeVMm: spanByAxis[def.vAxis],
    thicknessMm,
    sides,
  };
}

function sideIntervals(
  panel: PanelId,
  side: SideId,
  present: ReadonlySet<PanelId>,
  spanByAxis: Readonly<Record<Axis, number>>,
  patternByAxis: Readonly<Record<Axis, EdgePattern>>,
  thicknessMm: number,
): ReadonlyArray<SideInterval> {
  const def = PANEL_DEFS[panel];
  const sideAxis = side === 'vMin' || side === 'vMax' ? def.uAxis : def.vAxis;
  const pattern = patternByAxis[sideAxis];
  const lengthMm = spanByAxis[sideAxis];
  const startClaim = cornerClaimant(cornerAt(panel, side, 'min'), present) === panel;
  const endClaim = cornerClaimant(cornerAt(panel, side, 'max'), present) === panel;
  const mate = def.mates[side];
  const cells: SideInterval[] = present.has(mate)
    ? cellIntervals(
        pattern,
        AXIS_PRIORITY[def.normalAxis] < AXIS_PRIORITY[PANEL_DEFS[mate].normalAxis],
      )
    : [{ fromMm: pattern.interiorStartMm, toMm: pattern.interiorEndMm, owned: true }];
  return [
    { fromMm: 0, toMm: thicknessMm, owned: startClaim },
    ...cells,
    { fromMm: pattern.interiorEndMm, toMm: lengthMm, owned: endClaim },
  ];
}

function cellIntervals(pattern: EdgePattern, thisIsPrimary: boolean): SideInterval[] {
  const cells: SideInterval[] = [];
  for (let i = 0; i < pattern.cellCount; i += 1) {
    cells.push({
      fromMm: cellBoundary(pattern, i),
      toMm: cellBoundary(pattern, i + 1),
      owned: primaryOwnsCell(i) === thisIsPrimary,
    });
  }
  return cells;
}

// The cube corner at one end of a panel side, as per-axis min/max ends.
function cornerAt(panel: PanelId, side: SideId, sideEnd: AxisEnd): Readonly<Record<Axis, AxisEnd>> {
  const def = PANEL_DEFS[panel];
  const sideAxis = side === 'vMin' || side === 'vMax' ? def.uAxis : def.vAxis;
  const crossAxis = side === 'vMin' || side === 'vMax' ? def.vAxis : def.uAxis;
  const crossEnd: AxisEnd = side === 'vMin' || side === 'uMin' ? 'min' : 'max';
  const ends = { x: 'min', y: 'min', z: 'min' } as Record<Axis, AxisEnd>;
  ends[def.normalAxis] = def.normalEnd;
  ends[sideAxis] = sideEnd;
  ends[crossAxis] = crossEnd;
  return ends;
}

// Highest-priority present panel among the three that touch the corner cube.
// v1 only ever omits the top, so the fallback chain is z-panel then y-panel.
function cornerClaimant(
  corner: Readonly<Record<Axis, AxisEnd>>,
  present: ReadonlySet<PanelId>,
): PanelId {
  const zPanel: PanelId = corner.z === 'min' ? 'bottom' : 'top';
  if (present.has(zPanel)) return zPanel;
  return corner.y === 'min' ? 'front' : 'back';
}

function axisPattern(spec: BoxSpec, fullSpanMm: number): EdgePattern {
  return edgePattern({
    fullSpanMm,
    thicknessMm: spec.thicknessMm,
    targetFingerWidthMm: spec.targetFingerWidthMm,
  });
}
