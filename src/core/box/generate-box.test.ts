import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkBoxAssembly } from './assembly-referee';
import type { BoxSpec } from './box-spec';
import { generateBox, type BoxPanel } from './generate-box';
import { layoutPanelOffsets } from './layout';
import { buildPanelClaims } from './panel-claims';
import { panelOutline } from './panel-outline';
import { applyPanelFit } from './panel-fit';

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

const CNC: BoxSpec = {
  ...CANONICAL,
  clearanceMm: 0.15,
  relief: { kind: 'corner-overcut', toolDiameterMm: 3.175 },
};

function generated(spec: BoxSpec): ReadonlyArray<BoxPanel> {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(`expected generated, got ${result.kind}`);
  return result.panels;
}

describe('generateBox', () => {
  it('emits six named panels for a closed box, five for open-top', () => {
    expect(generated(CANONICAL).map((p) => p.name)).toEqual([
      'Bottom',
      'Top',
      'Front',
      'Back',
      'Left',
      'Right',
    ]);
    expect(generated({ ...CANONICAL, style: 'open-top' }).map((p) => p.name)).toEqual([
      'Bottom',
      'Front',
      'Back',
      'Left',
      'Right',
    ]);
  });

  it('returns the validation issues for an impossible spec without panels', () => {
    const result = generateBox({ ...CANONICAL, widthMm: -1 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('width');
  });

  // The referee proves the LOCAL outlines assemble exactly (assembly-referee
  // suite); this closes the remaining link: every sheet point is exactly
  // local + offset (same float expression, so === holds — un-translating
  // instead would lose ulps on boundaries like 40/3).
  it('translates the refereed local outlines verbatim onto the sheet', () => {
    for (const spec of [CANONICAL, { ...CANONICAL, style: 'open-top' as const }]) {
      const panels = generated(spec);
      const locals = buildPanelClaims(spec).map((claims) => {
        const fit = applyPanelFit(
          { outline: panelOutline(claims), cutouts: [] },
          { clearanceMm: spec.clearanceMm, relief: spec.relief },
        );
        if (fit.kind !== 'fitted') throw new Error(fit.detail);
        return { panel: claims.panel, outline: fit.outline };
      });
      expect(checkBoxAssembly(locals, spec)).toEqual([]);
      panels.forEach((panel, index) => {
        const local = locals[index];
        expect(local?.panel).toBe(panel.panel);
        if (local === undefined) return;
        expect(panel.outline.points.length).toBe(local.outline.points.length);
        panel.outline.points.forEach((point, k) => {
          const localPoint = local.outline.points[k];
          if (localPoint === undefined) return;
          expect(point.x).toBe(localPoint.x + panel.offsetMm.x);
          expect(point.y).toBe(localPoint.y + panel.offsetMm.y);
        });
      });
    }
  });

  it('separates neighbouring panels by exactly the part spacing', () => {
    const panels = generated(CANONICAL);
    const first = panels[0];
    const second = panels[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const firstMax = Math.max(...first.outline.points.map((p) => p.x));
    const secondMin = Math.min(...second.outline.points.map((p) => p.x));
    expect(secondMin - firstMax).toBeCloseTo(CANONICAL.partSpacingMm, 9);
  });

  it('anchors the sheet at the origin', () => {
    const panels = generated(CNC);
    const minX = Math.min(...panels.flatMap((p) => p.outline.points.map((q) => q.x)));
    const minY = Math.min(...panels.flatMap((p) => p.outline.points.map((q) => q.y)));
    expect(minX).toBeCloseTo(0, 9);
    expect(minY).toBeCloseTo(0, 9);
  });

  it('is deterministic: same spec, byte-identical output (CNC path included)', () => {
    expect(JSON.stringify(generateBox(CNC))).toBe(JSON.stringify(generateBox(CNC)));
    fc.assert(
      fc.property(
        fc.record({
          w: fc.double({ min: 20, max: 300, noNaN: true }),
          h: fc.double({ min: 20, max: 300, noNaN: true }),
        }),
        ({ w, h }) => {
          const spec: BoxSpec = { ...CNC, widthMm: w, heightMm: h };
          expect(JSON.stringify(generateBox(spec))).toBe(JSON.stringify(generateBox(spec)));
        },
      ),
      { numRuns: 20 },
    );
  }, 30000);
});

describe('layoutPanelOffsets', () => {
  it('wraps to a new row after three panels and clears the tallest', () => {
    const square = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const tall = { minX: 0, minY: 0, maxX: 10, maxY: 30 };
    const offsets = layoutPanelOffsets([square, tall, square, square], 5);
    expect(offsets[0]).toEqual({ x: 0, y: 0 });
    expect(offsets[1]).toEqual({ x: 15, y: 0 });
    expect(offsets[2]).toEqual({ x: 30, y: 0 });
    // Row 2 starts below the tallest panel of row 1 plus spacing.
    expect(offsets[3]).toEqual({ x: 0, y: 35 });
  });

  it('translates inset bounding boxes flush to the grid', () => {
    const inset = { minX: 2, minY: 3, maxX: 12, maxY: 13 };
    const offsets = layoutPanelOffsets([inset], 5);
    expect(offsets[0]).toEqual({ x: -2, y: -3 });
  });
});
