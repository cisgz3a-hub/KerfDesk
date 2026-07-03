// box-benchmark — the aggregated ADR-106 verification battery as a single
// reproducible scorecard. A seeded corpus (no Math.random — bit-identical
// every run) sweeps the fuzz ranges plus the known hard cases, and every
// category must score 100%:
//   assembly-exact      nominal referee: zero collisions/voids, true to size
//   assembly-clearance  fitted referee: uniform play == c, zero interference
//   structure           simple rectilinear rings, area exact vs claims
//   fit-relief          full-radius overcut at every reflex corner; laser
//                       output bit-identical at clearance 0
//   determinism         same spec ⇒ JSON-identical output, twice
//   sabotage-detection  the referee FAILS on all four broken-math classes
// Run alone for the scorecard:
//   pnpm exec vitest run src/__fixtures__/property/box-benchmark.test.ts

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { checkBoxAssembly, type RefereePanel } from '../../core/box/assembly-referee';
import { validateBoxSpec, type BoxSpec } from '../../core/box/box-spec';
import { edgePattern } from '../../core/box/edge-pattern';
import { generateBox } from '../../core/box/generate-box';
import { buildPanelClaims } from '../../core/box/panel-claims';
import { panelOutline } from '../../core/box/panel-outline';
import { applyPanelFit } from '../../core/box/panel-fit';

const SEED = 0x1057b0c5;
const SWEEP_SPECS = 48;
const BENCHMARK_TIMEOUT_MS = 120000;

type Score = { readonly category: string; passed: number; total: number };

describe('box generator benchmark', () => {
  it(
    'scores 100% across the full verification battery',
    () => {
      const corpus = buildCorpus();
      const scores: Score[] = [
        scoreAssemblyExact(corpus),
        scoreAssemblyClearance(corpus),
        scoreStructure(corpus),
        scoreFitRelief(corpus),
        scoreDeterminism(corpus),
        scoreSabotageDetection(),
      ];
      const totalPassed = scores.reduce((sum, s) => sum + s.passed, 0);
      const total = scores.reduce((sum, s) => sum + s.total, 0);
      const lines = scores.map(
        (s) =>
          `  ${s.category.padEnd(20)} ${String(s.passed).padStart(5)}/${String(s.total).padEnd(5)} ${s.passed === s.total ? '100%' : 'FAIL'}`,
      );
      console.log(
        [
          `[box-benchmark] seed=0x${SEED.toString(16)} corpus=${corpus.length} specs`,
          ...lines,
          `  ${'OVERALL'.padEnd(20)} ${String(totalPassed).padStart(5)}/${String(total).padEnd(5)} ${totalPassed === total ? '100%' : 'FAIL'}`,
        ].join('\n'),
      );
      for (const score of scores) {
        expect(`${score.category}:${score.passed}/${score.total}`).toBe(
          `${score.category}:${score.total}/${score.total}`,
        );
      }
      expect(totalPassed).toBe(total);
    },
    BENCHMARK_TIMEOUT_MS,
  );
});

// ---------- corpus ----------

function buildCorpus(): ReadonlyArray<BoxSpec> {
  const rand = mulberry32(SEED);
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

function spec(
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

// ---------- categories ----------

function scoreAssemblyExact(corpus: ReadonlyArray<BoxSpec>): Score {
  let passed = 0;
  for (const candidate of corpus) {
    if (checkBoxAssembly(localPanels(candidate), candidate).length === 0) passed += 1;
  }
  return { category: 'assembly-exact', passed, total: corpus.length };
}

function scoreAssemblyClearance(corpus: ReadonlyArray<BoxSpec>): Score {
  let passed = 0;
  for (const candidate of corpus) {
    const c = clearanceFor(candidate);
    const cleared = { ...candidate, clearanceMm: c };
    const panels = localPanels(cleared).map((panel) => {
      const fit = applyPanelFit(panel.outline, { clearanceMm: c, relief: { kind: 'none' } });
      return fit.kind === 'fitted' ? { panel: panel.panel, outline: fit.outline } : panel;
    });
    if (checkBoxAssembly(panels, cleared, { playMm: c }).length === 0) passed += 1;
  }
  return { category: 'assembly-clearance', passed, total: corpus.length };
}

function scoreStructure(corpus: ReadonlyArray<BoxSpec>): Score {
  let passed = 0;
  let total = 0;
  for (const candidate of corpus) {
    for (const claims of buildPanelClaims(candidate)) {
      total += 1;
      const ring = panelOutline(claims).points.slice(0, -1);
      if (isRectilinearSimple(ring) && areaMatchesClaims(ring, claims, candidate)) passed += 1;
    }
  }
  return { category: 'structure', passed, total };
}

function scoreFitRelief(corpus: ReadonlyArray<BoxSpec>): Score {
  let passed = 0;
  let total = 0;
  for (const candidate of corpus) {
    const toolMm = reliefToolFor(candidate);
    if (toolMm === null) continue;
    for (const claims of buildPanelClaims(candidate)) {
      const nominal = panelOutline(claims);
      // Laser identity: clearance 0 + no relief returns the input verbatim.
      total += 1;
      const laser = applyPanelFit(nominal, { clearanceMm: 0, relief: { kind: 'none' } });
      if (laser.kind === 'fitted' && laser.outline === nominal) passed += 1;
      // CNC: every reflex corner carries a full-radius overcut.
      total += 1;
      const cnc = applyPanelFit(nominal, {
        clearanceMm: 0,
        relief: { kind: 'corner-overcut', toolDiameterMm: toolMm },
      });
      if (cnc.kind === 'fitted' && reliefsAtFullRadius(nominal, cnc.outline, toolMm / 2)) {
        passed += 1;
      }
    }
  }
  return { category: 'fit-relief', passed, total };
}

function scoreDeterminism(corpus: ReadonlyArray<BoxSpec>): Score {
  let passed = 0;
  for (const candidate of corpus) {
    const cnc: BoxSpec = {
      ...candidate,
      clearanceMm: clearanceFor(candidate),
      relief:
        reliefToolFor(candidate) === null
          ? { kind: 'none' }
          : // Null-checked one line up; re-derive to keep the type narrow.
            { kind: 'corner-overcut', toolDiameterMm: reliefToolFor(candidate) ?? 1 },
    };
    if (JSON.stringify(generateBox(cnc)) === JSON.stringify(generateBox(cnc))) passed += 1;
  }
  return { category: 'determinism', passed, total: corpus.length };
}

// The referee must catch all four classic failure classes when the math is
// deliberately broken — a referee that cannot fail proves nothing.
function scoreSabotageDetection(): Score {
  const base = spec(60, 40, 30, 3, 9, 'closed');
  const checks: ReadonlyArray<() => boolean> = [
    () => tamperCell(base, 1).some((issue) => issue.includes('collide')),
    () => tamperCell(base, 2).some((issue) => issue.includes('void')),
    () => {
      const shifted = localPanels(base).map((panel) =>
        panel.panel === 'front'
          ? {
              panel: panel.panel,
              outline: {
                closed: true,
                points: panel.outline.points.map((p) => ({ x: p.x + 0.01, y: p.y })),
              },
            }
          : panel,
      );
      return checkBoxAssembly(shifted, base).length > 0;
    },
    () => tamperCorner(base).some((issue) => issue.includes('corner')),
  ];
  let passed = 0;
  for (const check of checks) if (check()) passed += 1;
  return { category: 'sabotage-detection', passed, total: checks.length };
}

// ---------- helpers ----------

function localPanels(candidate: BoxSpec): ReadonlyArray<RefereePanel> {
  return buildPanelClaims(candidate).map((claims) => ({
    panel: claims.panel,
    outline: panelOutline(claims),
  }));
}

function clearanceFor(candidate: BoxSpec): number {
  return Math.min(0.4, minCellMm(candidate) / 4, candidate.thicknessMm / 4);
}

function reliefToolFor(candidate: BoxSpec): number | null {
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

function isRectilinearSimple(ring: ReadonlyArray<Vec2>): boolean {
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

function areaMatchesClaims(
  ring: ReadonlyArray<Vec2>,
  claims: ReturnType<typeof buildPanelClaims>[number],
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
function reliefsAtFullRadius(nominal: Polyline, relieved: Polyline, radiusMm: number): boolean {
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

function minDistance(point: Vec2, outline: Polyline): number {
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

function tamperCell(base: BoxSpec, cellIndex: number): ReadonlyArray<string> {
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

function tamperCorner(base: BoxSpec): ReadonlyArray<string> {
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
