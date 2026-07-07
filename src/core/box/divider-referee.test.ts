import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Polyline } from '../scene';
import { validateBoxSpec, type BoxSpec } from './box-spec';
import { buildPanelClaims } from './panel-claims';
import { panelOutline } from './panel-outline';
import { applyPanelFit } from './panel-fit';
import { dividerLayout, hasDividers } from './divider-layout';
import { dividerPanelRings, wallSlotCutouts } from './divider-panels';
import { checkDividerAssembly, type DividerRefereeInput } from './divider-referee';

const BASE: BoxSpec = {
  widthMm: 90,
  depthMm: 60,
  heightMm: 40,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 1,
  dividersYCount: 1,
};

// Mirror of the orchestrator's composition, minus sheet layout: local rings
// through the same fit pass the shipped panels get.
function composed(spec: BoxSpec): DividerRefereeInput {
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

describe('divider referee — nominal exactness', () => {
  it('passes the canonical 1×1 grid, closed and open-top', () => {
    expect(checkDividerAssembly(composed(BASE), BASE)).toEqual([]);
    const open = { ...BASE, style: 'open-top' as const };
    expect(checkDividerAssembly(composed(open), open)).toEqual([]);
  });

  // 60 s: fuzz can exceed the 5 s default under full-suite load.
  it('holds exact slot/tab/lap complementarity over the fuzz corpus', () => {
    fc.assert(
      fc.property(specArb(), (spec) => {
        fc.pre(validateBoxSpec(spec).kind === 'valid' && hasDividers(spec));
        expect(checkDividerAssembly(composed(spec), spec)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  }, 60000);

  it('holds the play contract under clearance over the fuzz corpus', () => {
    fc.assert(
      fc.property(specArb(), fc.double({ min: 0.1, max: 0.4, noNaN: true }), (base, c) => {
        const spec = { ...base, clearanceMm: c };
        fc.pre(validateBoxSpec(spec).kind === 'valid' && hasDividers(spec));
        expect(checkDividerAssembly(composed(spec), spec, { playMm: c })).toEqual([]);
      }),
      { numRuns: 60 },
    );
  }, 60000);
});

describe('divider referee — negative controls', () => {
  it('catches a slot column shifted off the divider slab', () => {
    const input = composed(BASE);
    const tampered: DividerRefereeInput = {
      ...input,
      walls: input.walls.map((wall) =>
        wall.panel === 'front'
          ? { ...wall, cutouts: wall.cutouts.map((ring) => translate(ring, 1.5, 0)) }
          : wall,
      ),
    };
    expect(checkDividerAssembly(tampered, BASE)).not.toEqual([]);
  });

  it('catches a missing wall slot', () => {
    const input = composed(BASE);
    const tampered: DividerRefereeInput = {
      ...input,
      walls: input.walls.map((wall) =>
        wall.panel === 'back' ? { ...wall, cutouts: wall.cutouts.slice(1) } : wall,
      ),
    };
    expect(checkDividerAssembly(tampered, BASE).some((issue) => issue.includes('slots'))).toBe(
      true,
    );
  });

  it('catches a cross-lap at the wrong depth', () => {
    const input = composed(BASE);
    const tampered: DividerRefereeInput = {
      ...input,
      dividers: input.dividers.map((divider) =>
        divider.axis === 'x'
          ? { ...divider, outline: translate(divider.outline, 0, 0.5) }
          : divider,
      ),
    };
    expect(checkDividerAssembly(tampered, BASE)).not.toEqual([]);
  });

  it('catches a missing divider panel', () => {
    const input = composed(BASE);
    const tampered: DividerRefereeInput = { ...input, dividers: input.dividers.slice(1) };
    expect(checkDividerAssembly(tampered, BASE).some((issue) => issue.includes('missing'))).toBe(
      true,
    );
  });
});

function specArb(): fc.Arbitrary<BoxSpec> {
  return fc
    .record({
      w: fc.double({ min: 60, max: 400, noNaN: true }),
      d: fc.double({ min: 60, max: 400, noNaN: true }),
      h: fc.double({ min: 25, max: 200, noNaN: true }),
      t: fc.double({ min: 2, max: 8, noNaN: true }),
      finger: fc.double({ min: 2, max: 4, noNaN: true }),
      style: fc.constantFrom<BoxSpec['style']>('closed', 'open-top'),
      nx: fc.integer({ min: 0, max: 3 }),
      ny: fc.integer({ min: 0, max: 3 }),
    })
    .map(({ w, d, h, t, finger, style, nx, ny }) => ({
      widthMm: w,
      depthMm: d,
      heightMm: h,
      dimensionMode: 'inner' as const,
      thicknessMm: t,
      targetFingerWidthMm: finger * t,
      style,
      clearanceMm: 0,
      relief: { kind: 'none' as const },
      partSpacingMm: 8,
      dividersXCount: nx,
      dividersYCount: ny,
    }));
}

function translate(ring: Polyline, dx: number, dy: number): Polyline {
  return {
    closed: ring.closed,
    points: ring.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}
