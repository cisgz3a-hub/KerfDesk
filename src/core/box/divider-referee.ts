// divider-referee — the divider half of the virtual assembly check
// (ADR-116 V2). Consumes ONLY generated rings (walls with their slot
// cutouts, divider outlines) plus the spec; expected positions and junction
// cells are re-derived here from the spec'd formulas. Nominal mode compares
// exactly (shared float expressions); play mode checks the offset contract:
// tab-length play == c, thickness-direction play == c/2, laps == c/2.

import type { Polyline } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import { cellBoundary, edgePattern } from './edge-pattern';
import type { PanelId } from './panel-claims';

export type DividerRefereeWall = {
  readonly panel: PanelId;
  readonly cutouts: ReadonlyArray<Polyline>;
};

export type DividerRefereeDivider = {
  readonly axis: 'x' | 'y';
  readonly index: number;
  readonly outline: Polyline;
};

export type DividerRefereeInput = {
  readonly walls: ReadonlyArray<DividerRefereeWall>;
  readonly dividers: ReadonlyArray<DividerRefereeDivider>;
};

export type DividerRefereeOptions = { readonly playMm?: number; readonly toleranceMm?: number };

const DEFAULT_TOLERANCE_MM = 6e-3;

/** Empty result = every divider slots, tabs, and cross-laps as claimed. */
export function checkDividerAssembly(
  input: DividerRefereeInput,
  spec: BoxSpec,
  options: DividerRefereeOptions = {},
): ReadonlyArray<string> {
  const playMm = options.playMm ?? 0;
  const tolMm = options.toleranceMm ?? DEFAULT_TOLERANCE_MM;
  const expected = expectedGrid(spec);
  const issues: string[] = [];
  for (const axis of ['x', 'y'] as const) {
    const starts = axis === 'x' ? expected.xStarts : expected.yStarts;
    const wallPair: readonly [PanelId, PanelId] =
      axis === 'x' ? ['front', 'back'] : ['left', 'right'];
    const crossStarts = axis === 'x' ? expected.yStarts : expected.xStarts;
    starts.forEach((startMm, index) => {
      const divider = input.dividers.find((d) => d.axis === axis && d.index === index);
      if (divider === undefined) {
        issues.push(`divider ${axis}${index}: panel missing`);
        return;
      }
      issues.push(
        ...checkJunctions(divider, startMm, wallPair, input.walls, expected, spec, playMm, tolMm),
      );
      issues.push(...checkLaps(divider, axis, crossStarts, expected, spec, playMm, tolMm));
    });
  }
  return issues;
}

type ExpectedGrid = {
  readonly xStarts: ReadonlyArray<number>;
  readonly yStarts: ReadonlyArray<number>;
  readonly heightSpanMm: number;
  readonly tabCells: ReadonlyArray<{ readonly fromMm: number; readonly toMm: number }>;
  readonly uSpanX: number;
  readonly uSpanY: number;
};

// Re-derivation from the spec'd formulas (ADR-116): pitch spacing, and the
// shared junction sequence whose odd cells are tabs/slots.
function expectedGrid(spec: BoxSpec): ExpectedGrid {
  const dims = deriveBoxDims(spec);
  const t = spec.thicknessMm;
  const heightSpanMm = spec.style === 'open-top' ? dims.innerHeightMm + t : dims.innerHeightMm;
  const pattern = edgePattern({
    fullSpanMm: heightSpanMm + 2 * t,
    thicknessMm: t,
    targetFingerWidthMm: spec.targetFingerWidthMm,
  });
  const tabCells: Array<{ fromMm: number; toMm: number }> = [];
  for (let k = 1; k < pattern.cellCount; k += 2) {
    tabCells.push({
      fromMm: cellBoundary(pattern, k) - t,
      toMm: cellBoundary(pattern, k + 1) - t,
    });
  }
  return {
    xStarts: starts(spec.dividersXCount ?? 0, dims.innerWidthMm, t),
    yStarts: starts(spec.dividersYCount ?? 0, dims.innerDepthMm, t),
    heightSpanMm,
    tabCells,
    uSpanX: dims.outerDepthMm,
    uSpanY: dims.outerWidthMm,
  };
}

function starts(count: number, innerSpanMm: number, t: number): ReadonlyArray<number> {
  const pitch = (innerSpanMm - count * t) / (count + 1);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(t + (i + 1) * pitch + i * t);
  return out;
}

// Tab/slot complementarity at both mating walls: per odd cell, the wall
// carries exactly one slot in the divider's column and the divider a tab
// run at its face — equal at play 0; slot minus tab == play otherwise.
function checkJunctions(
  divider: DividerRefereeDivider,
  startMm: number,
  wallPair: readonly [PanelId, PanelId],
  walls: ReadonlyArray<DividerRefereeWall>,
  expected: ExpectedGrid,
  spec: BoxSpec,
  playMm: number,
  tolMm: number,
): string[] {
  const t = spec.thicknessMm;
  const label = `divider ${divider.axis}${divider.index}`;
  const uSpan = divider.axis === 'x' ? expected.uSpanX : expected.uSpanY;
  const tabsLeft = faceRuns(divider.outline, 'x', 0, playMm === 0 ? 0 : playMm);
  const tabsRight = faceRuns(divider.outline, 'x', uSpan, playMm === 0 ? 0 : playMm);
  const issues: string[] = [];
  for (const wallId of wallPair) {
    const wall = walls.find((candidate) => candidate.panel === wallId);
    if (wall === undefined) {
      issues.push(`${label}: mating wall ${wallId} missing`);
      continue;
    }
    issues.push(
      ...checkWallSlots({ wall, wallId, label, startMm, expected, t, playMm, tolMm, tabsLeft }),
    );
  }
  if (playMm === 0) {
    for (const [side, runs] of [
      ['left', tabsLeft],
      ['right', tabsRight],
    ] as const) {
      if (runs.length !== expected.tabCells.length) {
        issues.push(
          `${label}: ${side} face carries ${runs.length} tabs; expected ${expected.tabCells.length}`,
        );
        continue;
      }
      expected.tabCells.forEach((cell, k) => {
        const run = runs[k];
        if (run !== undefined && (run.fromMm !== cell.fromMm || run.toMm !== cell.toMm)) {
          issues.push(
            `${label}: ${side} tab ${k} at ${run.fromMm}..${run.toMm}, claimed ${cell.fromMm}..${cell.toMm}`,
          );
        }
      });
    }
  }
  return issues;
}

type WallSlotArgs = {
  readonly wall: DividerRefereeWall;
  readonly wallId: PanelId;
  readonly label: string;
  readonly startMm: number;
  readonly expected: ExpectedGrid;
  readonly t: number;
  readonly playMm: number;
  readonly tolMm: number;
  readonly tabsLeft: ReadonlyArray<{ fromMm: number; toMm: number }>;
};

// One wall's slot column: exact position/extent at play 0; the offset
// contract (length play == c, thickness play == c/2) otherwise.
function checkWallSlots(args: WallSlotArgs): string[] {
  const { wall, wallId, label, startMm, expected, t, playMm, tolMm, tabsLeft } = args;
  const issues: string[] = [];
  const column = wall.cutouts
    .map(bbox)
    .filter((box) => box.minX < startMm + t && box.maxX > startMm);
  if (column.length !== expected.tabCells.length) {
    return [
      `${label}: wall ${wallId} carries ${column.length} slots; expected ${expected.tabCells.length}`,
    ];
  }
  const sorted = [...column].sort((a, b) => a.minY - b.minY);
  expected.tabCells.forEach((cell, k) => {
    const slot = sorted[k];
    if (slot === undefined) return;
    const slotFrom = slot.minY - t;
    const slotTo = slot.maxY - t;
    if (playMm === 0) {
      if (slotFrom !== cell.fromMm || slotTo !== cell.toMm) {
        issues.push(
          `${label}: wall ${wallId} slot ${k} at ${slotFrom}..${slotTo}, claimed ${cell.fromMm}..${cell.toMm}`,
        );
      }
      if (slot.minX !== startMm || slot.maxX !== startMm + t) {
        issues.push(`${label}: wall ${wallId} slot ${k} column off the divider slab`);
      }
    } else {
      const lengthPlay = slotTo - slotFrom - (cell.toMm - cell.fromMm) + tabShrink(tabsLeft, cell);
      if (Math.abs(lengthPlay - playMm) > 2 * tolMm) {
        issues.push(`${label}: wall ${wallId} slot ${k} length play ${lengthPlay} ≠ ${playMm}`);
      }
      const thicknessPlay = slot.maxX - slot.minX - t;
      if (Math.abs(thicknessPlay - playMm / 2) > tolMm) {
        issues.push(
          `${label}: wall ${wallId} slot ${k} thickness play ${thicknessPlay} ≠ ${playMm / 2}`,
        );
      }
    }
  });
  return issues;
}

// The tab narrows by play/2 across its length under the fit offset; add it
// back so slot−tab measures the full joint play.
function tabShrink(
  runs: ReadonlyArray<{ fromMm: number; toMm: number }>,
  cell: { readonly fromMm: number; readonly toMm: number },
): number {
  const run = runs.find(
    (candidate) => candidate.fromMm < cell.toMm && candidate.toMm > cell.fromMm,
  );
  if (run === undefined) return 0;
  return cell.toMm - cell.fromMm - (run.toMm - run.fromMm);
}

// Egg-crate: X-dividers notched from the top, Y from the bottom, each half
// the height — the crossing pair must fill the span exactly.
function checkLaps(
  divider: DividerRefereeDivider,
  axis: 'x' | 'y',
  crossStarts: ReadonlyArray<number>,
  expected: ExpectedGrid,
  spec: BoxSpec,
  playMm: number,
  tolMm: number,
): string[] {
  const issues: string[] = [];
  const t = spec.thicknessMm;
  const lapDepth = expected.heightSpanMm / 2;
  const floorV = axis === 'x' ? expected.heightSpanMm - lapDepth : lapDepth;
  const label = `divider ${axis}${divider.index}`;
  for (const [j, slab] of crossStarts.entries()) {
    const floors = faceRuns(divider.outline, 'y', floorV, playMm === 0 ? 0 : playMm).filter(
      (run) => run.fromMm < slab + t && run.toMm > slab,
    );
    const floor = floors[0];
    if (floor === undefined) {
      issues.push(`${label}: cross-lap ${j} notch floor missing at v=${floorV}`);
      continue;
    }
    const width = floor.toMm - floor.fromMm;
    if (playMm === 0) {
      if (floor.fromMm !== slab || floor.toMm !== slab + t) {
        issues.push(
          `${label}: cross-lap ${j} at ${floor.fromMm}..${floor.toMm}, claimed ${slab}..${slab + t}`,
        );
      }
    } else if (Math.abs(width - t - playMm / 2) > tolMm) {
      issues.push(`${label}: cross-lap ${j} width play ${width - t} ≠ ${playMm / 2}`);
    }
  }
  return issues;
}

// Horizontal or vertical face runs of a ring: segments on the given line
// (within tolerance), as sorted intervals of the other coordinate.
function faceRuns(
  ring: Polyline,
  fixed: 'x' | 'y',
  value: number,
  tolMm = 0,
): Array<{ fromMm: number; toMm: number }> {
  const out: Array<{ fromMm: number; toMm: number }> = [];
  const pts = ring.points;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p === undefined || q === undefined) continue;
    const pFixed = fixed === 'x' ? p.x : p.y;
    const qFixed = fixed === 'x' ? q.x : q.y;
    if (Math.abs(pFixed - value) > tolMm || Math.abs(qFixed - value) > tolMm) continue;
    const pVary = fixed === 'x' ? p.y : p.x;
    const qVary = fixed === 'x' ? q.y : q.x;
    if (pVary === qVary) continue;
    out.push({ fromMm: Math.min(pVary, qVary), toMm: Math.max(pVary, qVary) });
  }
  return out.sort((a, b) => a.fromMm - b.fromMm);
}

function bbox(ring: Polyline): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
