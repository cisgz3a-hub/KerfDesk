import { describe, expect, it } from 'vitest';
import type { BoxSpec } from './box-spec';
import { generateBox } from './generate-box';
import { buildSlideLidParts } from './slide-lid-panels';
import { checkSlideLidAssembly, type SlideLidRefereePart } from './slide-lid-referee';

// Inner 80×50×30 T=3: outer 86×56×39 (H + 3T), channel band [33, 36],
// channel end at 53, front top at 33, lid 86 × 53.
const SPEC: BoxSpec = {
  widthMm: 80,
  depthMm: 50,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'slide-lid',
  clearanceMm: 0.2,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

function nominalParts(): ReadonlyArray<SlideLidRefereePart> {
  return buildSlideLidParts(SPEC).map((part) => ({
    panel: part.panel,
    outline: part.rings.outline,
  }));
}

describe('slide-lid builder + referee', () => {
  it('produces six named parts with the lid last', () => {
    expect(buildSlideLidParts(SPEC).map((part) => part.name)).toEqual([
      'Bottom',
      'Front',
      'Back',
      'Left',
      'Right',
      'Lid',
    ]);
  });

  it('passes the nominal geometry exactly (pre-fit rings)', () => {
    expect(checkSlideLidAssembly(nominalParts(), SPEC)).toEqual([]);
  });

  it('passes the sliding contract on the generated (fitted) panels', () => {
    const result = generateBox(SPEC);
    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') return;
    expect(result.panels.map((p) => p.name)).toEqual([
      'Bottom',
      'Front',
      'Back',
      'Left',
      'Right',
      'Lid',
    ]);
    const locals = result.panels.map((panel) => ({
      panel: panel.panel,
      outline: {
        closed: panel.outline.closed,
        points: panel.outline.points.map((p) => ({
          x: p.x - panel.offsetMm.x,
          y: p.y - panel.offsetMm.y,
        })),
      },
    }));
    expect(checkSlideLidAssembly(locals, SPEC, { playMm: SPEC.clearanceMm })).toEqual([]);
  });

  it('rejects zero clearance via validation (a lid that cannot slide)', () => {
    const result = generateBox({ ...SPEC, clearanceMm: 0 });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.issues[0]?.field).toBe('clearance');
    expect(result.issues[0]?.message).toContain('slide');
  });

  it('composes with dividers (slots land in the short front too)', () => {
    const result = generateBox({ ...SPEC, dividersXCount: 1, dividersYCount: 1 });
    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') return;
    expect(result.panels).toHaveLength(8);
    const front = result.panels.find((p) => p.panel === 'front');
    expect(front?.cutouts.length).toBeGreaterThan(0);
  });
});

describe('slide-lid referee — negative controls', () => {
  it('catches a full-height front (lid cannot pass)', () => {
    const parts = nominalParts().map((part) =>
      part.panel === 'front'
        ? {
            panel: part.panel,
            outline: {
              closed: true,
              points: part.outline.points.map((p) => ({ x: p.x, y: p.y * 1.15 })),
            },
          }
        : part,
    );
    expect(checkSlideLidAssembly(parts, SPEC)).not.toEqual([]);
  });

  it('catches a missing channel (plain open-top walls)', () => {
    const parts = nominalParts().map((part) =>
      part.panel === 'left'
        ? {
            panel: part.panel,
            outline: {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 56, y: 0 },
                { x: 56, y: 39 },
                { x: 0, y: 39 },
                { x: 0, y: 0 },
              ],
            },
          }
        : part,
    );
    expect(checkSlideLidAssembly(parts, SPEC).some((issue) => issue.includes('channel'))).toBe(
      true,
    );
  });

  it('catches a lid long enough to jam against the back wall', () => {
    const parts = nominalParts().map((part) =>
      part.panel === 'lid'
        ? {
            panel: part.panel,
            outline: {
              closed: true,
              points: part.outline.points.map((p) => ({ x: p.x, y: p.y * 1.1 })),
            },
          }
        : part,
    );
    expect(checkSlideLidAssembly(parts, SPEC).some((issue) => issue.includes('lid'))).toBe(true);
  });

  it('catches a lid without the thumb notch', () => {
    const parts = nominalParts().map((part) =>
      part.panel === 'lid'
        ? {
            panel: part.panel,
            outline: {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 86, y: 0 },
                { x: 86, y: 53 },
                { x: 0, y: 53 },
                { x: 0, y: 0 },
              ],
            },
          }
        : part,
    );
    expect(checkSlideLidAssembly(parts, SPEC).some((issue) => issue.includes('thumb'))).toBe(true);
  });
});
