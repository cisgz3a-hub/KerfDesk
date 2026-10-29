import { describe, expect, it } from 'vitest';
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

// The template laid out at 7 mm, its first baseline 5.46 mm below its ink top.
const TEMPLATE = { sizeMm: 7, y: 5.46 };

describe('onTextBoxBaseline (ADR-682 Amendment 1)', () => {
  it('puts a record on the template baseline scaled to its own size (N4-P2-1)', () => {
    // The template shrank to 7 mm; the record fits at 10 mm.
    const moved = onTextBoxBaseline(framed(10, 7.5, 7.5), TEMPLATE);
    expect(moved.anchor?.y).toBeCloseTo(7.8, 9);
    expect(moved.bounds.minY).toBeCloseTo(0.3, 9);
    expect(moved.paths[0]?.polylines[0]?.points[1]?.y).toBeCloseTo(7.8, 9);
    expect(moved.textBoxLayout?.overflow).toBe(false);
  });

  it('reports a record lifted over the frame top as overflow (N4-P3-3)', () => {
    const lifted = onTextBoxBaseline(framed(10, 11.5, 9.46), TEMPLATE);
    expect(lifted.anchor?.y).toBeCloseTo(7.8, 9);
    expect(lifted.bounds.minY).toBeCloseTo(-1.66, 9);
    expect(lifted.textBoxLayout?.overflow).toBe(true);
  });

  it('leaves a record whose ink fills the frame where the frame put it', () => {
    const full = framed(9, 20, 13);
    expect(onTextBoxBaseline(full, TEMPLATE)).toBe(full);
  });
});
