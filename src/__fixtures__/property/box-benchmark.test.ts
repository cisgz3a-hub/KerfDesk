// box-benchmark — the aggregated ADR-106/116 verification battery as a
// single reproducible scorecard. A seeded corpus (no Math.random —
// bit-identical every run) sweeps the fuzz ranges plus the known hard
// cases, and every category must score 100%:
//   assembly-exact      nominal referee: zero collisions/voids, true to size
//   assembly-clearance  fitted referee: uniform play == c, zero interference
//   structure           simple rectilinear rings, area exact vs claims
//   fit-relief          full-radius overcut at every reflex corner; laser
//                       output bit-identical at clearance 0
//   determinism         same spec ⇒ JSON-identical output, twice
//   cutouts             multi-ring fit invariants (ADR-116 V1)
//   sabotage-detection  the referee FAILS on all four broken-math classes
// Run alone for the scorecard:
//   pnpm exec vitest run src/__fixtures__/property/box-benchmark.test.ts

import { describe, expect, it } from 'vitest';
import { checkBoxAssembly, type RefereePanel } from '../../core/box/assembly-referee';
import { checkDividerAssembly } from '../../core/box/divider-referee';
import type { BoxSpec } from '../../core/box/box-spec';
import { generateBox } from '../../core/box/generate-box';
import { buildPanelClaims } from '../../core/box/panel-claims';
import { panelOutline } from '../../core/box/panel-outline';
import { applyPanelFit } from '../../core/box/panel-fit';
import {
  BENCHMARK_SEED,
  composeDividerInput,
  areaMatchesClaims,
  buildCorpus,
  clearanceFor,
  isRectilinearSimple,
  minDistance,
  rectRing,
  reliefToolFor,
  reliefsAtFullRadius,
  ringSpan,
  spec,
  tamperCell,
  tamperCorner,
} from './box-benchmark-support';

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
        scoreCutouts(),
        scoreDividers(),
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
          `[box-benchmark] seed=0x${BENCHMARK_SEED.toString(16)} corpus=${corpus.length} specs`,
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
      const fit = applyPanelFit(
        { outline: panel.outline, cutouts: [] },
        { clearanceMm: c, relief: { kind: 'none' } },
      );
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
      const laser = applyPanelFit(
        { outline: nominal, cutouts: [] },
        { clearanceMm: 0, relief: { kind: 'none' } },
      );
      if (laser.kind === 'fitted' && laser.outline === nominal) passed += 1;
      // CNC: every reflex corner carries a full-radius overcut.
      total += 1;
      const cnc = applyPanelFit(
        { outline: nominal, cutouts: [] },
        { clearanceMm: 0, relief: { kind: 'corner-overcut', toolDiameterMm: toolMm } },
      );
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
    const toolMm = reliefToolFor(candidate);
    const cnc: BoxSpec = {
      ...candidate,
      clearanceMm: clearanceFor(candidate),
      relief:
        toolMm === null ? { kind: 'none' } : { kind: 'corner-overcut', toolDiameterMm: toolMm },
    };
    if (JSON.stringify(generateBox(cnc)) === JSON.stringify(generateBox(cnc))) passed += 1;
  }
  return { category: 'determinism', passed, total: corpus.length };
}

// Multi-ring fit invariants (ADR-116 V1): synthetic panels with slot
// cutouts must keep their ring count, widen slots by c/2, carve full-radius
// overcuts at slot corners, stay bit-identical at c=0, and stay
// deterministic.
function scoreCutouts(): Score {
  const outline = rectRing(0, 0, 120, 80);
  const slots = [rectRing(20, 30, 28, 50), rectRing(60, 20, 100, 26)];
  const rings = { outline, cutouts: slots };
  const toolMm = 3.175;
  let passed = 0;
  let total = 0;
  total += 1;
  const identity = applyPanelFit(rings, { clearanceMm: 0, relief: { kind: 'none' } });
  if (
    identity.kind === 'fitted' &&
    identity.outline === outline &&
    identity.cutouts[0] === slots[0]
  ) {
    passed += 1;
  }
  for (const c of [0.1, 0.2, 0.4]) {
    total += 1;
    const fit = applyPanelFit(rings, { clearanceMm: c, relief: { kind: 'none' } });
    if (fit.kind === 'fitted' && fit.cutouts.length === 2) {
      const widened = fit.cutouts.every((cutout, i) => {
        const nominal = slots[i];
        if (nominal === undefined) return false;
        const grewX = ringSpan(cutout).x - ringSpan(nominal).x;
        const grewY = ringSpan(cutout).y - ringSpan(nominal).y;
        return Math.abs(grewX - c / 2) <= 4e-3 && Math.abs(grewY - c / 2) <= 4e-3;
      });
      if (widened) passed += 1;
    }
  }
  total += 1;
  const relieved = applyPanelFit(rings, {
    clearanceMm: 0,
    relief: { kind: 'corner-overcut', toolDiameterMm: toolMm },
  });
  if (relieved.kind === 'fitted' && relieved.cutouts.length === 2) {
    const ok = slots.every((slot, i) => {
      const hole = relieved.cutouts[i];
      if (hole === undefined) return false;
      return slot.points.slice(0, -1).every((corner) => {
        const d = minDistance(corner, hole);
        return d >= 0.98 * (toolMm / 2) && d <= toolMm / 2 + 2e-3;
      });
    });
    if (ok) passed += 1;
  }
  total += 1;
  const a = applyPanelFit(rings, {
    clearanceMm: 0.2,
    relief: { kind: 'corner-overcut', toolDiameterMm: toolMm },
  });
  const b = applyPanelFit(rings, {
    clearanceMm: 0.2,
    relief: { kind: 'corner-overcut', toolDiameterMm: toolMm },
  });
  if (JSON.stringify(a) === JSON.stringify(b)) passed += 1;
  return { category: 'cutouts', passed, total };
}

// Divider grids (ADR-116 V2): exact slot/tab/lap complementarity, the play
// contract under clearance, determinism, and the 0-divider regression.
function scoreDividers(): Score {
  const grids: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [2, 1],
    [3, 2],
  ];
  let passed = 0;
  let total = 0;
  for (const style of ['closed', 'open-top'] as const) {
    for (const [nx, ny] of grids) {
      const gridSpec: BoxSpec = {
        ...spec(120, 90, 40, 3, 9, style),
        dividersXCount: nx,
        dividersYCount: ny,
      };
      total += 1;
      if (checkDividerAssembly(composeDividerInput(gridSpec), gridSpec).length === 0) passed += 1;
      total += 1;
      const played: BoxSpec = { ...gridSpec, clearanceMm: 0.3 };
      if (checkDividerAssembly(composeDividerInput(played), played, { playMm: 0.3 }).length === 0) {
        passed += 1;
      }
      total += 1;
      if (JSON.stringify(generateBox(gridSpec)) === JSON.stringify(generateBox(gridSpec))) {
        passed += 1;
      }
    }
  }
  // 0-divider regression: absent fields and explicit zeros are byte-equal.
  total += 1;
  const plain = spec(120, 90, 40, 3, 9, 'closed');
  const zeros: BoxSpec = { ...plain, dividersXCount: 0, dividersYCount: 0 };
  if (JSON.stringify(generateBox(plain)) === JSON.stringify(generateBox(zeros))) passed += 1;
  return { category: 'dividers', passed, total };
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

function localPanels(candidate: BoxSpec): ReadonlyArray<RefereePanel> {
  return buildPanelClaims(candidate).map((claims) => ({
    panel: claims.panel,
    outline: panelOutline(claims),
  }));
}
