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
  it('retains the measured endpoints of a uniformly wide clean run', () => {
    const widths = profile(() => 5, 40);
    const [run] = wideStrokeRuns(widths, 4);
    expect(run?.[0]).toEqual({ x: 0, y: 0 });
    expect(run?.at(-1)).toEqual({ x: 39.5, y: 0 });
  });

  it('preserves clean wide endpoints on both sides of a junction without joining the gap', () => {
    const widths = profile((x) => (x >= 40 && x < 50 ? null : 5));
    const runs = wideStrokeRuns(widths, 4);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.at(-1)).toEqual({ x: 39.5, y: 0 });
    expect(runs[1]?.[0]).toEqual({ x: 50, y: 0 });
  });

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

  // ADR-454 Amendment 3: a pen line wobbling around the gate stays one run.
  it.each([1, 2, 4])('joins wide runs across near-gate ink at %ix', (scale) => {
    const wobble = profile(
      (x) => (Math.floor(x / (12 * scale)) % 2 === 0 ? 5 : 4) * scale,
      108 * scale,
    );
    const runs = wideStrokeRuns(wobble, 4 * scale);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.[0]).toEqual({ x: 0, y: 0 });
    expect(runs[0]?.at(-1)).toEqual({ x: 108 * scale - 0.5, y: 0 });
    for (const [width, joined] of [
      [3.4, false],
      [3.6, true],
    ] as const) {
      const neck = profile(
        (x) => (x >= 30 * scale && x < 50 * scale ? width : 6) * scale,
        80 * scale,
      );
      expect(wideStrokeRuns(neck, 4 * scale), `${width} px neck`).toHaveLength(joined ? 1 : 2);
    }
  });

  it('leaves a near-gate end beyond the last wide run out of the run', () => {
    const runs = wideStrokeRuns(
      profile((x) => (x < 40 ? 6 : 4)),
      4,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.at(-1)!.x).toBeLessThan(44);
  });

  it("does not split a closed stroke's wide evidence at its arbitrary seam", () => {
    const widths = profile((x) => (x < 4 || x >= 96 ? 6 : 2));
    expect(wideStrokeRuns(widths, 4, true)).toHaveLength(1);
  });
});
