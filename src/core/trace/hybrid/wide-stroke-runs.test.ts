import { describe, expect, it } from 'vitest';
import { wideStrokeRuns } from './wide-stroke-runs';
import type { MeasuredCrossSection, StrokeWidthProfile } from './stroke-width';

function profile(widthAt: (x: number) => number | null, length = 100): StrokeWidthProfile {
  const measurements: Array<MeasuredCrossSection | null> = Array.from(
    { length: 2 * length },
    (_, i) => {
      const x = i / 2;
      const widthPx = widthAt(x);
      return widthPx === null
        ? null
        : { p: { x, y: 0 }, normal: { x: 0, y: 1 }, offsetPx: 0, widthPx };
    },
  );
  return { medianPx: 2, spreadPx: 0, sections: [], measurements };
}

describe('local wide-stroke evidence', () => {
  it.each([1, 2, 4])('uses the same relative width allowance at %ix', (scale) => {
    for (const [width, wide] of [
      [4.24, false],
      [4.26, true],
    ] as const) {
      const widths = profile((x) => (x < 30 * scale ? 2 * scale : width * scale), 60 * scale);
      expect(wideStrokeRuns(widths, 4 * scale).length > 0).toBe(wide);
    }
  });

  it('keeps separated wide islands separate instead of connecting them through thin ink', () => {
    const widths = profile((x) => ((x >= 20 && x < 28) || (x >= 60 && x < 68) ? 6 : 2));
    const runs = wideStrokeRuns(widths, 4);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.at(-1)!.x).toBeLessThan(32);
    expect(runs[1]![0]!.x).toBeGreaterThan(56);
  });

  it('does not combine short evidence across an unmeasurable junction', () => {
    const widths = profile((x) => (x >= 40 && x < 46 ? (x === 43 ? null : 6) : 2));
    expect(wideStrokeRuns(widths, 4)).toEqual([]);
  });

  it('ignores a brief one-pixel width blot but keeps a supported thick section', () => {
    expect(
      wideStrokeRuns(
        profile((x) => (x >= 40 && x < 43 ? 5 : 4)),
        4,
      ),
    ).toEqual([]);
    expect(
      wideStrokeRuns(
        profile((x) => (x >= 40 && x < 48 ? 6 : 2)),
        4,
      ),
    ).toHaveLength(1);
  });

  it("does not split a closed stroke's wide evidence at its arbitrary seam", () => {
    const widths = profile((x) => (x < 4 || x >= 96 ? 6 : 2));
    expect(wideStrokeRuns(widths, 4, true)).toHaveLength(1);
  });
});
