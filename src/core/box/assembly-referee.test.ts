import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkBoxAssembly, type RefereePanel } from './assembly-referee';
import { validateBoxSpec, type BoxSpec } from './box-spec';
import { buildPanelClaims, type PanelClaims } from './panel-claims';
import { panelOutline } from './panel-outline';

const REFEREE_RUNS = 100;

const CANONICAL: BoxSpec = {
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

function generatedPanels(spec: BoxSpec): ReadonlyArray<RefereePanel> {
  return buildPanelClaims(spec).map((claims) => ({
    panel: claims.panel,
    outline: panelOutline(claims),
  }));
}

const specArb = fc
  .record({
    w: fc.double({ min: 20, max: 600, noNaN: true }),
    d: fc.double({ min: 20, max: 600, noNaN: true }),
    h: fc.double({ min: 20, max: 600, noNaN: true }),
    finger: fc.double({ min: 1.5, max: 5, noNaN: true }),
    style: fc.constantFrom<BoxSpec['style']>('closed', 'open-top'),
    mode: fc.constantFrom<BoxSpec['dimensionMode']>('inner', 'outer'),
  })
  .chain((base) =>
    fc
      .double({
        min: 1,
        max: Math.min(25, (Math.min(base.w, base.d, base.h) - 2) / 2),
        noNaN: true,
      })
      .map(
        (t): BoxSpec => ({
          widthMm: base.w,
          depthMm: base.d,
          heightMm: base.h,
          dimensionMode: base.mode,
          thicknessMm: t,
          targetFingerWidthMm: base.finger * t,
          style: base.style,
          clearanceMm: 0,
          relief: { kind: 'none' },
          partSpacingMm: 8,
        }),
      ),
  );

describe('assembly referee — every fuzzed nominal box assembles exactly', () => {
  // 60 s: 100 fuzz runs can exceed the 5 s default under full-suite load.
  it('finds zero collisions, voids, or size errors over the fuzz corpus', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        expect(validateBoxSpec(spec).kind).toBe('valid');
        expect(checkBoxAssembly(generatedPanels(spec), spec)).toEqual([]);
      }),
      { numRuns: REFEREE_RUNS },
    );
  }, 60000);

  it('passes the canonical closed and open-top boxes', () => {
    expect(checkBoxAssembly(generatedPanels(CANONICAL), CANONICAL)).toEqual([]);
    const open = { ...CANONICAL, style: 'open-top' as const };
    expect(checkBoxAssembly(generatedPanels(open), open)).toEqual([]);
  });
});

// Test-of-the-test: the referee must FAIL when the math is deliberately
// broken, otherwise a green referee proves nothing (CLAUDE.md rule 2).
describe('assembly referee — negative controls', () => {
  it('catches a panel whose fingers shifted off the shared sequence', () => {
    const panels = generatedPanels(CANONICAL).map((panel) =>
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
    expect(checkBoxAssembly(panels, CANONICAL)).not.toEqual([]);
  });

  it('catches a double-claimed edge cell (parts collide)', () => {
    const issues = checkBoxAssembly(withFlippedCell(CANONICAL, 1), CANONICAL);
    expect(issues.some((issue) => issue.includes('collide'))).toBe(true);
  });

  it('catches a never-claimed edge cell (visible void)', () => {
    const issues = checkBoxAssembly(withFlippedCell(CANONICAL, 2), CANONICAL);
    expect(issues.some((issue) => issue.includes('void'))).toBe(true);
  });

  it('catches a double-claimed corner cube', () => {
    const panels = generatedPanels(CANONICAL).map((panel) =>
      panel.panel === 'front' ? { panel: panel.panel, outline: withCornerSquare() } : panel,
    );
    const issues = checkBoxAssembly(panels, CANONICAL);
    expect(issues.some((issue) => issue.includes('corner'))).toBe(true);
  });
});

// Rebuild the front panel with one bottom-edge cell ownership flipped: index
// 1 flips false→true (double claim), index 2 flips true→false (void).
function withFlippedCell(spec: BoxSpec, cellIndex: number): ReadonlyArray<RefereePanel> {
  return buildPanelClaims(spec).map((claims) => {
    if (claims.panel !== 'front') return { panel: claims.panel, outline: panelOutline(claims) };
    const tampered: PanelClaims = {
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
}

// A front panel that grabs its bottom-left corner square although the bottom
// panel already owns that corner cube.
function withCornerSquare(): RefereePanel['outline'] {
  const claims = buildPanelClaims(CANONICAL).find((c) => c.panel === 'front');
  if (claims === undefined) throw new Error('missing front');
  const tampered: PanelClaims = {
    ...claims,
    sides: {
      ...claims.sides,
      vMin: claims.sides.vMin.map((interval, i) =>
        i === 0 ? { ...interval, owned: true } : interval,
      ),
    },
  };
  return panelOutline(tampered);
}
