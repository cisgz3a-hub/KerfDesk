import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import type { BoxSpec } from './box-spec';
import { buildPanelClaims } from './panel-claims';
import { panelOutline } from './panel-outline';
import { applyPanelFit } from './panel-fit';

// Canonical 60×40×30 T=3, finger 9 → x edges: 5 cells of 12 mm at
// boundaries 3, 15, 27, 39, 51, 63. Bottom owns cells 0/2/4.
const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

const RELIEF_TOOL_MM = 3.175;
const RELIEF_RADIUS_MM = RELIEF_TOOL_MM / 2;
// A 24-gon inscribed in the relief circle puts the boundary between
// r·cos(π/24) and r; clipper adds ±1e-3 rounding.
const RELIEF_DISTANCE_MIN = 0.98 * RELIEF_RADIUS_MM;
const RELIEF_DISTANCE_MAX = RELIEF_RADIUS_MM + 2e-3;

function outlineOf(panel: string): Polyline {
  const claims = buildPanelClaims(SPEC).find((c) => c.panel === panel);
  if (claims === undefined) throw new Error(`missing panel ${panel}`);
  return panelOutline(claims);
}

function fitted(outline: Polyline, clearanceMm: number, toolMm?: number): Polyline {
  const result = applyPanelFit(
    { outline, cutouts: [] },
    {
      clearanceMm,
      relief:
        toolMm === undefined
          ? { kind: 'none' }
          : { kind: 'corner-overcut', toolDiameterMm: toolMm },
    },
  );
  if (result.kind !== 'fitted') throw new Error(result.detail);
  return result.outline;
}

// Horizontal segments near a face line, as sorted x-intervals.
function faceRuns(outline: Polyline, faceY: number, tolMm: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const pts = outline.points;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p === undefined || q === undefined) continue;
    if (Math.abs(p.y - faceY) > tolMm || Math.abs(q.y - faceY) > tolMm) continue;
    runs.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
  }
  return runs.sort((a, b) => a[0] - b[0]);
}

function minDistanceToBoundary(point: Vec2, outline: Polyline): number {
  let best = Number.POSITIVE_INFINITY;
  const pts = outline.points;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, pointSegmentDistance(point, a, b));
  }
  return best;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lenSq = abX * abX + abY * abY;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abX + (p.y - a.y) * abY) / lenSq));
  return Math.hypot(p.x - (a.x + t * abX), p.y - (a.y + t * abY));
}

describe('applyPanelFit — clearance', () => {
  it('returns the input bit-identical at clearance 0 with no relief (laser nominal)', () => {
    const outline = outlineOf('bottom');
    const result = applyPanelFit(
      { outline, cutouts: [] },
      { clearanceMm: 0, relief: { kind: 'none' } },
    );
    expect(result.kind).toBe('fitted');
    if (result.kind !== 'fitted') return;
    expect(result.outline).toBe(outline);
  });

  it('delivers exactly c of play per joint: tab narrows c/2, notch widens c/2', () => {
    const c = 0.4;
    const bottom = fitted(outlineOf('bottom'), c);
    const front = fitted(outlineOf('front'), c);
    // Bottom's isolated tab at cell 2 (nominal [27, 39]); face recedes c/4.
    const tab = faceRuns(bottom, c / 4, 1e-3).find(([from, to]) => from > 20 && to < 46);
    expect(tab).toBeDefined();
    if (tab === undefined) return;
    const tabWidth = tab[1] - tab[0];
    expect(Math.abs(tabWidth - (12 - c / 2))).toBeLessThanOrEqual(4e-3);
    // Front's mating notch at the same cell: its flanks are the ends of the
    // face runs on either side (cells 1 and 3 are front's tabs).
    const frontRuns = faceRuns(front, c / 4, 1e-3);
    const before = frontRuns.find(([, to]) => Math.abs(to - (27 - c / 4)) < 0.1);
    const after = frontRuns.find(([from]) => Math.abs(from - (39 + c / 4)) < 0.1);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (before === undefined || after === undefined) return;
    const notchWidth = after[0] - before[1];
    expect(Math.abs(notchWidth - (12 + c / 2))).toBeLessThanOrEqual(4e-3);
    // The joint contract: notch − tab == c, centered (not lopsided).
    expect(Math.abs(notchWidth - tabWidth - c)).toBeLessThanOrEqual(6e-3);
    const tabCenter = (tab[0] + tab[1]) / 2;
    const notchCenter = (before[1] + after[0]) / 2;
    expect(Math.abs(tabCenter - notchCenter)).toBeLessThanOrEqual(3e-3);
  });

  it('grows tabs into a press fit for negative clearance', () => {
    const c = -0.2;
    const bottom = fitted(outlineOf('bottom'), c);
    const tab = faceRuns(bottom, c / 4, 1e-3).find(([from, to]) => from > 20 && to < 46);
    expect(tab).toBeDefined();
    if (tab === undefined) return;
    expect(Math.abs(tab[1] - tab[0] - (12 + 0.1))).toBeLessThanOrEqual(4e-3);
  });

  it('reports a degenerate result instead of emitting a consumed panel', () => {
    const result = applyPanelFit(
      { outline: outlineOf('bottom'), cutouts: [] },
      { clearanceMm: 1e6, relief: { kind: 'none' } },
    );
    expect(result.kind).toBe('degenerate');
  });
});

describe('applyPanelFit — corner relief', () => {
  it('subtracts a full-radius overcut at every notch floor corner', () => {
    const relieved = fitted(outlineOf('bottom'), 0, RELIEF_TOOL_MM);
    // Nominal reflex corners of the cell-1 notch on the bottom edge.
    for (const corner of [
      { x: 15, y: 3 },
      { x: 27, y: 3 },
    ]) {
      const distance = minDistanceToBoundary(corner, relieved);
      expect(distance).toBeGreaterThanOrEqual(RELIEF_DISTANCE_MIN);
      expect(distance).toBeLessThanOrEqual(RELIEF_DISTANCE_MAX);
    }
  });

  it('keeps the full bit radius when clearance is applied first (pinned ordering)', () => {
    const c = 0.3;
    const relieved = fitted(outlineOf('bottom'), c, RELIEF_TOOL_MM);
    // The cell-1 notch after offset: walls at 15−c/4 and 27+c/4 … the reflex
    // corner sits at (15 − c/4, 3 + c/4). Relief-then-offset would leave the
    // arc at r − c/4 ≈ 1.51 mm — outside the accepted band.
    const offsetCorner = { x: 15 - c / 4, y: 3 + c / 4 };
    const distance = minDistanceToBoundary(offsetCorner, relieved);
    expect(distance).toBeGreaterThanOrEqual(RELIEF_DISTANCE_MIN);
    expect(distance).toBeLessThanOrEqual(RELIEF_DISTANCE_MAX);
  });

  it('never emits reliefs in laser mode and leaves relief-free faces alone', () => {
    const square: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
        { x: 0, y: 0 },
      ],
    };
    // A plain rectangle has no reflex corners: CNC relief is a no-op.
    const result = applyPanelFit(
      { outline: square, cutouts: [] },
      { clearanceMm: 0, relief: { kind: 'corner-overcut', toolDiameterMm: RELIEF_TOOL_MM } },
    );
    expect(result.kind).toBe('fitted');
    if (result.kind !== 'fitted') return;
    expect(result.outline).toBe(square);
  });

  it('increases vertex count only in CNC mode', () => {
    const nominal = outlineOf('bottom');
    const laser = fitted(nominal, 0);
    const cnc = fitted(nominal, 0, RELIEF_TOOL_MM);
    expect(laser.points.length).toBe(nominal.points.length);
    expect(cnc.points.length).toBeGreaterThan(nominal.points.length);
  });
});

describe('applyPanelFit — cutout rings (ADR-116)', () => {
  const outline = rect(0, 0, 100, 60);
  const slot = rect(20, 25, 30, 35);

  it('returns rings bit-identical at clearance 0 with no relief', () => {
    const rings = { outline, cutouts: [slot] };
    const result = applyPanelFit(rings, { clearanceMm: 0, relief: { kind: 'none' } });
    expect(result.kind).toBe('fitted');
    if (result.kind !== 'fitted') return;
    expect(result.outline).toBe(outline);
    expect(result.cutouts[0]).toBe(slot);
  });

  it('widens every cutout by c/2 while the outline shrinks by c/2', () => {
    const c = 0.4;
    const result = applyPanelFit(
      { outline, cutouts: [slot] },
      { clearanceMm: c, relief: { kind: 'none' } },
    );
    expect(result.kind).toBe('fitted');
    if (result.kind !== 'fitted') return;
    const outer = span(result.outline);
    expect(Math.abs(outer.x - (100 - c / 2))).toBeLessThanOrEqual(4e-3);
    expect(Math.abs(outer.y - (60 - c / 2))).toBeLessThanOrEqual(4e-3);
    const hole = result.cutouts[0];
    expect(hole).toBeDefined();
    if (hole === undefined) return;
    const holeSpan = span(hole);
    // A 10 mm slot mating a 10 mm tab: slot +c/2, tab −c/2 ⇒ play c.
    expect(Math.abs(holeSpan.x - (10 + c / 2))).toBeLessThanOrEqual(4e-3);
    expect(Math.abs(holeSpan.y - (10 + c / 2))).toBeLessThanOrEqual(4e-3);
  });

  it('carves a full-radius overcut at every slot corner', () => {
    const result = applyPanelFit(
      { outline, cutouts: [slot] },
      { clearanceMm: 0, relief: { kind: 'corner-overcut', toolDiameterMm: RELIEF_TOOL_MM } },
    );
    expect(result.kind).toBe('fitted');
    if (result.kind !== 'fitted') return;
    expect(result.cutouts).toHaveLength(1);
    const hole = result.cutouts[0];
    if (hole === undefined) return;
    for (const corner of [
      { x: 20, y: 25 },
      { x: 30, y: 25 },
      { x: 30, y: 35 },
      { x: 20, y: 35 },
    ]) {
      const distance = minDistanceToBoundary(corner, hole);
      expect(distance).toBeGreaterThanOrEqual(RELIEF_DISTANCE_MIN);
      expect(distance).toBeLessThanOrEqual(RELIEF_DISTANCE_MAX);
    }
  });

  it('reports severed instead of silently dropping a breached cutout', () => {
    const breaching = rect(95, 25, 105, 35);
    const result = applyPanelFit(
      { outline, cutouts: [breaching] },
      { clearanceMm: 0.2, relief: { kind: 'none' } },
    );
    expect(result.kind).toBe('degenerate');
  });
});

function rect(x0: number, y0: number, x1: number, y1: number): Polyline {
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

function span(ring: Polyline): Vec2 {
  const xs = ring.points.map((p) => p.x);
  const ys = ring.points.map((p) => p.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}
