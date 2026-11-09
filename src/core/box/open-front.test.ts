import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { deriveBoxDims, validateBoxSpec, type BoxSpec } from './box-spec';
import { checkBoxAssembly } from './assembly-referee';
import { checkDividerAssembly, type DividerRefereeInput } from './divider-referee';
import { generateBox, type BoxPanel } from './generate-box';
import { buildPanelClaims, type PanelId } from './panel-claims';
import { panelOutline } from './panel-outline';

// Inner 60 × 40 × 30, T = 3, open front: outer 66 × 43 × 36 — the depth adds
// only the back wall (ADR-693).
const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'open-front',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

function unshift(ring: Polyline, panel: BoxPanel): Polyline {
  return {
    closed: true,
    points: ring.points.map((p) => ({ x: p.x - panel.offsetMm.x, y: p.y - panel.offsetMm.y })),
  };
}

function localPanels(spec: BoxSpec): ReadonlyArray<BoxPanel> {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(JSON.stringify(result));
  return result.panels.map((panel) => ({
    ...panel,
    outline: unshift(panel.outline, panel),
    cutouts: panel.cutouts.map((cutout) => unshift(cutout, panel)),
  }));
}

function isWall(panel: BoxPanel['panel']): panel is PanelId {
  return panel !== 'divider' && panel !== 'lid' && panel !== 'lid-lip';
}

function dividerInput(panels: ReadonlyArray<BoxPanel>): DividerRefereeInput {
  return {
    walls: panels.flatMap((panel) =>
      isWall(panel.panel) ? [{ panel: panel.panel, cutouts: panel.cutouts }] : [],
    ),
    dividers: panels.flatMap((panel) =>
      panel.divider === undefined ? [] : [{ ...panel.divider, outline: panel.outline }],
    ),
  };
}

describe('open-front box (ADR-693)', () => {
  it('derives the depth from the back wall alone', () => {
    const dims = deriveBoxDims(SPEC);
    expect(dims.outerDepthMm).toBe(43);
    expect(dims.outerHeightMm).toBe(36);
    const outer = deriveBoxDims({ ...SPEC, dimensionMode: 'outer', depthMm: 43 });
    expect(outer.innerDepthMm).toBe(40);
  });

  it('drops the front and keeps a straight front edge on the bottom and top', () => {
    const panels = localPanels(SPEC);
    expect(panels.map((panel) => panel.name)).toEqual(['Bottom', 'Top', 'Back', 'Left', 'Right']);
    for (const name of ['Bottom', 'Top']) {
      const panel = panels.find((candidate) => candidate.name === name);
      const onFront = (panel?.outline.points ?? []).filter((p) => p.y === 0).map((p) => p.x);
      expect([Math.min(...onFront), Math.max(...onFront)]).toEqual([0, 66]);
    }
  });

  it('passes the exact assembly referee with no front panel', () => {
    // Pre-layout outlines: the exact referee compares shared floats, which
    // undoing the sheet offset would disturb.
    const walls = buildPanelClaims(SPEC).map((claims) => ({
      panel: claims.panel,
      outline: panelOutline(claims),
    }));
    expect(walls.map((wall) => wall.panel)).not.toContain('front');
    expect(checkBoxAssembly(walls, SPEC)).toEqual([]);
  });

  it('ends dividers flush at the opening and slots only the back wall', () => {
    const panels = localPanels({ ...SPEC, dividersXCount: 2 });
    const dividers = panels.filter((panel) => panel.panel === 'divider');
    expect(dividers).toHaveLength(2);
    for (const divider of dividers) {
      const front = divider.outline.points.filter((p) => p.x === 0).map((p) => p.y);
      // One straight front edge from the floor to the top of the divider.
      expect([...new Set(front)].sort((a, b) => a - b)).toEqual([0, 30]);
    }
    expect(panels.find((panel) => panel.name === 'Back')?.cutouts.length).toBeGreaterThan(0);
  });

  it('proves the open-front divider junctions, exact and with play', () => {
    for (const clearanceMm of [0, 0.3]) {
      const spec = { ...SPEC, clearanceMm, dividersXCount: 3 };
      expect(
        checkDividerAssembly(dividerInput(localPanels(spec)), spec, { playMm: clearanceMm }),
      ).toEqual([]);
    }
  });

  it('catches a divider that still carries tabs at the open front', () => {
    const spec = { ...SPEC, dividersXCount: 1 };
    const input = dividerInput(localPanels(spec));
    const divider = input.dividers[0];
    expect(divider).toBeDefined();
    if (divider === undefined) return;
    // Mirror the back end's tabs onto the front: what a closed box would cut.
    const mirrored = {
      ...divider,
      outline: {
        closed: true,
        points: divider.outline.points.map((p) => ({ x: 43 - p.x, y: p.y })),
      },
    };
    expect(
      checkDividerAssembly({ ...input, dividers: [mirrored] }, spec).some((issue) =>
        issue.includes('open front end'),
      ),
    ).toBe(true);
  });

  it('rejects dividers across the depth: they would close the opening', () => {
    const result = validateBoxSpec({ ...SPEC, dividersYCount: 1 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('dividersY');
  });
});
