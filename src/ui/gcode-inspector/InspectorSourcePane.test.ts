// The windowing maths is the part of the source pane that must be right at
// a million lines; it is exported pure so it can be checked without a DOM.
import { describe, expect, it } from 'vitest';
import { visibleRange } from './InspectorSourcePane';

const ROW_HEIGHT_PX = 18;
const OVERSCAN_ROWS = 12;

describe('visibleRange', () => {
  it('mounts only a viewport-sized window plus overscan', () => {
    const range = visibleRange(0, 360, 1_000_000);
    expect(range.first).toBe(0);
    // 360px / 18px = 20 rows, plus overscan above and below.
    expect(range.last).toBe(20 + OVERSCAN_ROWS * 2);
    expect(range.last - range.first).toBeLessThan(100);
  });

  it('tracks the scroll position with overscan above', () => {
    const range = visibleRange(100 * ROW_HEIGHT_PX, 360, 1_000_000);
    expect(range.first).toBe(100 - OVERSCAN_ROWS);
    expect(range.last).toBeGreaterThan(100);
  });

  it('never runs past the start or the end of the program', () => {
    expect(visibleRange(0, 360, 5).last).toBe(5);
    expect(visibleRange(5 * ROW_HEIGHT_PX, 360, 5)).toEqual({ first: 0, last: 5 });
    expect(visibleRange(0, 360, 0)).toEqual({ first: 0, last: 0 });
  });
});
