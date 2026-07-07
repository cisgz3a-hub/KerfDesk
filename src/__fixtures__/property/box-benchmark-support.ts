// box-benchmark-support — the seeded corpus, geometry checks, and tamper
// builders behind the box benchmark scorecard (split from
// box-benchmark.test.ts at the file-size cap). Test-only fixture module;
// everything here is pure and deterministic (no Math.random, no clock).

import type { Polyline, Vec2 } from '../../core/scene';
import { checkBoxAssembly } from '../../core/box/assembly-referee';
import { validateBoxSpec, type BoxSpec } from '../../core/box/box-spec';
import { edgePattern } from '../../core/box/edge-pattern';
import { buildPanelClaims, type PanelClaims } from '../../core/box/panel-claims';
import { panelOutline } from '../../core/box/panel-outline';
import { applyPanelFit } from '../../core/box/panel-fit';
import { dividerLayout } from '../../core/box/divider-layout';
import { dividerPanelRings, wallSlotCutouts } from '../../core/box/divider-panels';
import type { DividerRefereeInput } from '../../core/box/divider-referee';

export const BENCHMARK_SEED = 0x1057b0c5;
const SWEEP_SPECS = 48;

export function buildCorpus(): ReadonlyArray<BoxSpec> {
  const rand = mulberry32(BENCHMARK_SEED);
  const specs: BoxSpec[] = [];
  for (let i = 0; i < SWEEP_SPECS; i += 1) {
    const w = 20 + rand() * 580;
    const d = 20 + rand() * 580;
    const h = 20 + rand() * 580;
    const t = 1 + rand() * Math.min(24, (Math.min(w, d, h) - 2) / 2 - 1);
    specs.push({
      widthMm: w,
      depthMm: d,
      heightMm: h,
      dimensionMode: rand() < 0.5 ? 'inner' : 'outer',
      thicknessMm: t,
      targetFingerWidthMm: (1.5 + rand() * 3.5) * t,
      style: rand() < 0.5 ? 'closed' : 'open-top',
      clearanceMm: 0,
      relief: { kind: 'none' },
      partSpacingMm: 8,
    });
  }
  // Known hard cases: n=1 fallback, thin stock, max stock, huge box, slab.
  specs.push(
    spec(60, 40, 30, 3, 9, 'closed'),
    spec(60, 40, 30, 3, 9, 'open-top'),
    spec(20, 20, 20, 6, 30, 'closed'),
    spec(600, 600, 600, 25, 40, 'closed'),
    spec(500, 22, 22, 1, 1.5, 'open-top'),
    spec(40, 40, 4.5, 1, 5, 'closed'),
  );
  return specs.filter((candidate) => validateBoxSpec(candidate).kind === 'valid');
}

export function spec(
  w: number,
  d: number,
  h: number,
  t: number,
  finger: number,
  style: BoxSpec['style'],
): BoxSpec {
  return {
    widthMm: w,
    depthMm: d,
    heightMm: h,
    dimensionMode: 'inner',
    thicknessMm: t,
    targetFingerWidthMm: finger,
    style,
    clearanceMm: 0,
    relief: { kind: 'none' },
    partSpacingMm: 8,
  };
}

// Deterministic 32-bit PRNG so the corpus is bit-identical on every run.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clearanceFor(candidate: BoxSpec): number {
  return Math.min(0.4, minCellMm(candidate) / 4, candidate.thicknessMm / 4);
}

export function reliefToolFor(candidate: BoxSpec): number | null {
  const toolMm = Math.min(3.175, minCellMm(candidate) * 0.6);
  const withRelief: BoxSpec = {
    ...candidate,
    relief: { kind: 'corner-overcut', toolDiameterMm: toolMm },
  };
  return validateBoxSpec(withRelief).kind === 'valid' ? toolMm : null;
}

function minCellMm(candidate: BoxSpec): number {
  const t2 = 2 * candidate.thicknessMm;
  const outer =
    candidate.dimensionMode === 'inner'
      ? [candidate.widthMm + t2, candidate.depthMm + t2, candidate.heightMm + t2]
      : [candidate.widthMm, candidate.depthMm, candidate.heightMm];
  return Math.min(
    ...outer.map(
      (fullSpanMm) =>
        edgePattern({
          fullSpanMm,
          thicknessMm: candidate.thicknessMm,
          targetFingerWidthMm: candidate.targetFingerWidthMm,
        }).cellWidthMm,
    ),
  );
}

export function isRectilinearSimple(ring: ReadonlyArray<Vec2>): boolean {
  if (ring.length < 4) return false;
  const seen = new Set<string>();
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const c = ring[(i + 2) % ring.length];
    if (a === undefined || b === undefined || c === undefined) return false;
    seen.add(`${a.x},${a.y}`);
    const abHorizontal = a.y === b.y;
    if (abHorizontal ? a.x === b.x : a.x !== b.x) return false;
    if ((b.y === c.y) !== !abHorizontal) return false;
  }
  return seen.size === ring.length;
}

export function areaMatchesClaims(
  ring: ReadonlyArray<Vec2>,
  claims: PanelClaims,
  candidate: BoxSpec,
): boolean {
  let expected = claims.sizeUMm * claims.sizeVMm;
  for (const side of ['vMin', 'uMax', 'vMax', 'uMin'] as const) {
    const intervals = claims.sides[side];
    for (let i = 1; i < intervals.length - 1; i += 1) {
      const cell = intervals[i];
      if (cell !== undefined && !cell.owned) {
        expected -= (cell.toMm - cell.fromMm) * candidate.thicknessMm;
      }
    }
  }
  for (const side of ['vMin', 'vMax'] as const) {
    const intervals = claims.sides[side];
    const first = intervals[0];
    const last = intervals[intervals.length - 1];
    if (first !== undefined && !first.owned) expected -= candidate.thicknessMm ** 2;
    if (last !== undefined && !last.owned) expected -= candidate.thicknessMm ** 2;
  }
  return Math.abs(shoelace(ring) - expected) <= 1e-6 * expected;
}

function shoelace(ring: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// Every reflex corner of the nominal ring must sit ~one bit radius away
// from the relieved boundary (24-gon chord bound + clipper rounding).
export function reliefsAtFullRadius(
  nominal: Polyline,
  relieved: Polyline,
  radiusMm: number,
): boolean {
  const ring = nominal.points.slice(0, -1);
  for (let i = 0; i < ring.length; i += 1) {
    const prev = ring[(i + ring.length - 1) % ring.length];
    const curr = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (prev === undefined || curr === undefined || next === undefined) return false;
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    if (cross >= 0) continue;
    const distance = minDistance(curr, relieved);
    if (distance < 0.98 * radiusMm || distance > radiusMm + 2e-3) return false;
  }
  return true;
}

export function minDistance(point: Vec2, outline: Polyline): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < outline.points.length; i += 1) {
    const a = outline.points[i];
    const b = outline.points[i + 1];
    if (a === undefined || b === undefined) continue;
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lenSq = abX * abX + abY * abY;
    const t =
      lenSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lenSq));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * abX), point.y - (a.y + t * abY)));
  }
  return best;
}

export function rectRing(x0: number, y0: number, x1: number, y1: number): Polyline {
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

export function ringSpan(ring: Polyline): Vec2 {
  const xs = ring.points.map((p) => p.x);
  const ys = ring.points.map((p) => p.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

// The four broken-math classes the referee must catch (test-of-the-test).
export function tamperCell(base: BoxSpec, cellIndex: number): ReadonlyArray<string> {
  const panels = buildPanelClaims(base).map((claims) => {
    if (claims.panel !== 'front') return { panel: claims.panel, outline: panelOutline(claims) };
    const tampered = {
      ...claims,
      sides: {
        ...claims.sides,
        vMin: claims.sides.vMin.map((interval, i) =>
          i === cellIndex ? { ...interval, owned: !interval.owned } : interval,
        ),
      },
    };
    return { panel: claims.panel, outline: panelOutline(tampered) };
  });
  return checkBoxAssembly(panels, base);
}

export function tamperCorner(base: BoxSpec): ReadonlyArray<string> {
  const panels = buildPanelClaims(base).map((claims) => {
    if (claims.panel !== 'front') return { panel: claims.panel, outline: panelOutline(claims) };
    const tampered = {
      ...claims,
      sides: {
        ...claims.sides,
        vMin: claims.sides.vMin.map((interval, i) =>
          i === 0 ? { ...interval, owned: true } : interval,
        ),
      },
    };
    return { panel: claims.panel, outline: panelOutline(tampered) };
  });
  return checkBoxAssembly(panels, base);
}

// Orchestrator-mirror composition for the divider referee: local rings
// through the same fit pass the shipped panels get.
export function composeDividerInput(spec: BoxSpec): DividerRefereeInput {
  const layout = dividerLayout(spec);
  const slots = wallSlotCutouts(layout, spec);
  const walls = buildPanelClaims(spec).map((claims) => {
    const fit = applyPanelFit(
      { outline: panelOutline(claims), cutouts: slots.get(claims.panel) ?? [] },
      { clearanceMm: spec.clearanceMm, relief: spec.relief },
    );
    if (fit.kind !== 'fitted') throw new Error(fit.detail);
    return { panel: claims.panel, outline: fit.outline, cutouts: fit.cutouts };
  });
  const dividers = [...layout.xDividers, ...layout.yDividers].map((placement) => {
    const fit = applyPanelFit(dividerPanelRings(layout, placement, spec), {
      clearanceMm: spec.clearanceMm,
      relief: spec.relief,
    });
    if (fit.kind !== 'fitted') throw new Error(fit.detail);
    return { axis: placement.axis, index: placement.index, outline: fit.outline };
  });
  return { walls, dividers };
}
