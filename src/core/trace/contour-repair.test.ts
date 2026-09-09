import { describe, expect, it, vi } from 'vitest';
import type { Polyline } from '../scene';
import { preserveContourTopologySteps, type FinishedContour } from './contour-topology';
import { runTraceSteps } from './trace-steps';

function square(x: number, size: number): Polyline {
  const first = { x, y: x };
  return {
    closed: true,
    points: [first, { x: x + size, y: x }, { x: x + size, y: x + size }, { x, y: x + size }, first],
  };
}
function candidate(source: Polyline, output = source): FinishedContour {
  return { source, baseline: source, polyline: output, refine: vi.fn(() => source) };
}

describe('contour refinement correction', () => {
  it('leaves already valid geometry byte-identical without rerunning the fit', () => {
    const a = candidate(square(0, 5));
    const b = candidate(square(5 + 1e-12, 1));
    const result = runTraceSteps(preserveContourTopologySteps([a, b]));
    expect(result[0]).toBe(a.polyline);
    expect(result[1]).toBe(b.polyline);
    expect(a.refine).not.toHaveBeenCalled();
    expect(b.refine).not.toHaveBeenCalled();
  });
  it('repairs a changed nesting relationship even without intersecting boundaries', () => {
    const outer = candidate(square(0, 5));
    const hole = candidate(square(1, 1), square(8, 1));
    expect(runTraceSteps(preserveContourTopologySteps([outer, hole]))).toEqual([
      outer.source,
      hole.source,
    ]);
    expect(hole.refine).toHaveBeenCalled();
  });
  it('keeps unrelated valid contours unchanged during repair', () => {
    const first = candidate(square(0, 1), square(0, 2));
    const second = candidate(square(1.1, 1));
    const distant = candidate(square(20, 2));
    const result = runTraceSteps(preserveContourTopologySteps([first, second, distant]));
    expect(result[2]).toBe(distant.polyline);
    expect(distant.refine).not.toHaveBeenCalled();
  });
  it('retains source boundaries if earlier fitting geometry is also invalid', () => {
    const source = square(0, 2);
    const invalid: Polyline = {
      closed: true,
      points: [
        source.points[0]!,
        source.points[2]!,
        source.points[1]!,
        source.points[3]!,
        source.points[0]!,
      ],
    };
    const input: FinishedContour = {
      source,
      baseline: invalid,
      polyline: invalid,
      refine: vi.fn(() => invalid),
    };
    const result = runTraceSteps(preserveContourTopologySteps([input]));
    expect(result).toEqual([source]);
    expect(input.polyline).toBe(invalid);
  });
});
