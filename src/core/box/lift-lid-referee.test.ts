import { describe, expect, it } from 'vitest';
import type { BoxSpec } from './box-spec';
import { framePoint, partFrame } from './assembled-layout';
import { generateBox, type BoxPanel } from './generate-box';
import { buildLiftLidParts } from './lift-lid-panels';
import { checkLiftLidAssembly, type LiftLidRefereePart } from './lift-lid-referee';

// Inner 60 × 40 × 30, T = 3: outer 66 × 46 × 39 (bottom + cavity + lip band +
// lid top). The walls stand 36 high; the lid rests on that rim.
const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'lift-lid',
  clearanceMm: 0.2,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

function localParts(spec: BoxSpec): ReadonlyArray<BoxPanel> {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error(JSON.stringify(result));
  return result.panels.map((panel) => ({
    ...panel,
    outline: {
      closed: true,
      points: panel.outline.points.map((p) => ({
        x: p.x - panel.offsetMm.x,
        y: p.y - panel.offsetMm.y,
      })),
    },
  }));
}

function size(part: LiftLidRefereePart): { w: number; d: number } {
  const xs = part.outline.points.map((p) => p.x);
  const ys = part.outline.points.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

function scaled(part: BoxPanel, factor: number): BoxPanel {
  return {
    ...part,
    outline: {
      closed: true,
      points: part.outline.points.map((p) => ({ x: p.x * factor, y: p.y * factor })),
    },
  };
}

function find(parts: ReadonlyArray<BoxPanel>, panel: BoxPanel['panel']): BoxPanel {
  const part = parts.find((candidate) => candidate.panel === panel);
  if (part === undefined) throw new Error(`${panel} missing`);
  return part;
}

describe('lift-off lid builder + referee (ADR-693)', () => {
  it('builds five body walls, the lid and its lip', () => {
    expect(buildLiftLidParts(SPEC).map((part) => part.name)).toEqual([
      'Bottom',
      'Front',
      'Back',
      'Left',
      'Right',
      'Lid',
      'Lid lip',
    ]);
  });

  it('sizes the lid to the footprint and leaves the full play around the lip', () => {
    const parts = localParts(SPEC);
    // The fit offset takes c/4 off every edge.
    expect(size(find(parts, 'lid')).w).toBeCloseTo(66 - 0.1, 3);
    expect(size(find(parts, 'lid')).d).toBeCloseTo(46 - 0.1, 3);
    // The opening is 60 × 40 between stock faces; play == clearance across it.
    expect(size(find(parts, 'lid-lip')).w).toBeCloseTo(60 - 0.2, 3);
    expect(size(find(parts, 'lid-lip')).d).toBeCloseTo(40 - 0.2, 3);
    expect(checkLiftLidAssembly(parts, SPEC, { playMm: 0.2 })).toEqual([]);
  });

  it('stands the walls one thickness under the outer height', () => {
    for (const part of localParts(SPEC)) {
      if (!['front', 'back', 'left', 'right'].includes(part.panel)) continue;
      expect(Math.max(...part.outline.points.map((p) => p.y))).toBeCloseTo(36 - 0.05, 3);
    }
  });

  it('keeps the entered outer height as the overall height in outer mode', () => {
    const outer: BoxSpec = {
      ...SPEC,
      dimensionMode: 'outer',
      widthMm: 66,
      depthMm: 46,
      heightMm: 39,
    };
    const parts = localParts(outer);
    expect(checkLiftLidAssembly(parts, outer, { playMm: 0.2 })).toEqual([]);
    const sizes = (list: ReadonlyArray<BoxPanel>) =>
      list.map((part) => {
        const s = size(part);
        return [s.w.toFixed(6), s.d.toFixed(6)];
      });
    expect(sizes(parts)).toEqual(sizes(localParts(SPEC)));
  });

  it('places the lid on the rim and the lip centred inside it', () => {
    const parts = localParts(SPEC);
    const lid = partFrame(find(parts, 'lid'), SPEC);
    const lip = partFrame(find(parts, 'lid-lip'), SPEC);
    expect(lid?.originMm).toEqual({ x: 0, y: 0, z: 36 });
    expect(lip?.originMm).toEqual({ x: 3, y: 3, z: 33 });
    if (lip === null || lip === undefined) return;
    // The fitted lip spans local 0.1..59.9: 0.1 mm from each wall face.
    expect(framePoint(lip, 0.1, 0.1, 0).x).toBeCloseTo(3.1, 9);
  });

  it('composes with dividers that stop under the lip', () => {
    const result = generateBox({ ...SPEC, dividersXCount: 2, dividersYCount: 1 });
    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') return;
    const divider = find(result.panels, 'divider');
    const ys = divider.outline.points.map((p) => p.y);
    // Cavity height 30: the divider tops out under the lip band.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30 - 0.1, 3);
  });

  it('rejects zero clearance: the lip could not drop in', () => {
    const result = generateBox({ ...SPEC, clearanceMm: 0 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('clearance');
  });
});

describe('lift-off lid referee — negative controls', () => {
  const parts = localParts(SPEC);
  const replace = (panel: string, next: BoxPanel): ReadonlyArray<BoxPanel> =>
    parts.map((part) => (part.panel === panel ? next : part));
  const issuesWith = (list: ReadonlyArray<BoxPanel>, prefix: string): boolean =>
    checkLiftLidAssembly(list, SPEC, { playMm: 0.2 }).some((issue) => issue.startsWith(prefix));

  it('catches a lip as wide as the opening (no play: it jams)', () => {
    const lip = find(parts, 'lid-lip');
    expect(issuesWith(replace('lid-lip', scaled(lip, 60 / size(lip).w)), 'lid lip')).toBe(true);
  });

  it('catches a lid smaller than the footprint', () => {
    expect(issuesWith(replace('lid', scaled(find(parts, 'lid'), 0.95)), 'lid:')).toBe(true);
  });

  it('catches a wall standing up past the rim', () => {
    expect(issuesWith(replace('front', scaled(find(parts, 'front'), 1.1)), 'front')).toBe(true);
  });

  it('catches a missing lip', () => {
    expect(
      checkLiftLidAssembly(
        parts.filter((part) => part.panel !== 'lid-lip'),
        SPEC,
        { playMm: 0.2 },
      ),
    ).toContain('lid lip: panel missing');
  });
});
