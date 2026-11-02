import { describe, expect, it } from 'vitest';
import type { TextBoxSettings } from '../scene/text-box';
import { onTextBoxBaseline } from './text-box-render';
import type { TextRenderResult } from './text-to-polylines';

// A frame render as finishTextBoxRender leaves it: ink top at the frame top,
// the first baseline `baselineY` below it, in a 20 mm tall frame.
function framed(sizeMm: number, inkHeight: number, baselineY: number): TextRenderResult {
  return {
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: inkHeight },
            ],
          },
        ],
      },
    ],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: inkHeight },
    anchor: { x: 40, y: baselineY },
    textBoxLayout: {
      content: '',
      sizeMm,
      widthMm: 80,
      heightMm: 20,
      lineCount: 1,
      advanceWidthMm: 10,
      overflow: false,
    },
  };
}

const BOX: TextBoxSettings = {
  mode: 'fixed',
  widthMm: 80,
  heightMm: 20,
  wrap: true,
  fit: 'shrink',
  minSizeMm: 2,
};

// The template laid out at 7 mm, its first baseline 5.46 mm below its ink top.
const TEMPLATE = { sizeMm: 7, y: 5.46 };

describe('onTextBoxBaseline (ADR-682 Amendment 1)', () => {
  it('puts a record on the template baseline scaled to its own size (N4-P2-1)', () => {
    // The template shrank to 7 mm; the record fits at 10 mm.
    const moved = onTextBoxBaseline(framed(10, 7.5, 7.5), TEMPLATE, BOX);
    expect(moved.anchor?.y).toBeCloseTo(7.8, 9);
    expect(moved.bounds.minY).toBeCloseTo(0.3, 9);
    expect(moved.paths[0]?.polylines[0]?.points[1]?.y).toBeCloseTo(7.8, 9);
    expect(moved.textBoxLayout?.overflow).toBe(false);
  });

  it('reports a record lifted over the frame top as overflow (N4-P3-3)', () => {
    const lifted = onTextBoxBaseline(framed(10, 11.5, 9.46), TEMPLATE, BOX);
    expect(lifted.anchor?.y).toBeCloseTo(7.8, 9);
    expect(lifted.bounds.minY).toBeCloseTo(-1.66, 9);
    expect(lifted.textBoxLayout?.overflow).toBe(true);
  });

  it('leaves a record whose ink fills the frame where the frame put it', () => {
    const full = framed(9, 20, 13);
    expect(onTextBoxBaseline(full, TEMPLATE, BOX)).toBe(full);
  });

  describe('a record the baseline would carry past the frame bottom (ADR-682 Amendment 2)', () => {
    // Size 10, ink 15.5 mm tall with its baseline 7.5 mm down. Scaled to Size
    // 10 the template's baseline is 7.8 mm down, so the bottom would land at
    // 15.8 mm: the ink fits the 15.6 mm frame, the moved ink does not.
    const FRAME: TextBoxSettings = { ...BOX, heightMm: 15.6 };
    const deep = (): TextRenderResult => {
      const record = framed(10, 15.5, 7.5);
      const layout = record.textBoxLayout;
      if (layout === undefined) throw new Error('no layout');
      return { ...record, textBoxLayout: { ...layout, heightMm: 15.6 } };
    };

    it('shrinks a shrink-to-fit record until it fits on the template baseline', () => {
      const refit = onTextBoxBaseline(deep(), TEMPLATE, FRAME);
      const k = 15.6 / 15.8;
      expect(refit.bounds.maxY).toBeCloseTo(15.6, 9);
      expect(refit.textBoxLayout?.sizeMm).toBeCloseTo(10 * k, 9);
      expect(refit.anchor?.y).toBeCloseTo(7.8 * k, 9);
      expect(refit.textBoxLayout?.overflow).toBe(false);
    });

    it('keeps the alignment point across the frame as it shrinks', () => {
      const refit = onTextBoxBaseline(deep(), TEMPLATE, FRAME);
      const k = 15.6 / 15.8;
      expect(refit.anchor?.x).toBe(40);
      // Ink at x 0..10 stays the same distance, scaled, from x = 40.
      expect(refit.bounds.minX).toBeCloseTo(40 - 40 * k, 9);
      expect(refit.bounds.maxX).toBeCloseTo(40 - 30 * k, 9);
      expect(refit.paths[0]?.polylines[0]?.points[1]?.x).toBeCloseTo(refit.bounds.maxX, 9);
    });

    it('stops at the frame’s smallest size and reports the overflow', () => {
      const held = onTextBoxBaseline(deep(), TEMPLATE, { ...FRAME, minSizeMm: 9.95 });
      expect(held.textBoxLayout?.sizeMm).toBeCloseTo(9.95, 9);
      expect(held.bounds.maxY).toBeGreaterThan(15.6);
      expect(held.textBoxLayout?.overflow).toBe(true);
    });

    it('does not resize a frame that is not shrink-to-fit', () => {
      const moved = onTextBoxBaseline(deep(), TEMPLATE, { ...FRAME, fit: 'none' });
      expect(moved.textBoxLayout?.sizeMm).toBe(10);
      expect(moved.bounds.maxY).toBeCloseTo(15.8, 9);
      expect(moved.textBoxLayout?.overflow).toBe(true);
    });
  });
});
