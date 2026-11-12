import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConstrainedSketch2d } from '../../core/sketch-constraints/constrained-sketch';
import { solveConstrainedSketch } from '../../core/sketch-constraints/solve-constrained-sketch';
import { SketchSolveReview } from './SketchSolveReview';

// Oracle audit O10-P3-1: horizontal and vertical on one line solve exactly by
// shrinking it to a point. The solve is not a conflict, so the review names
// the vanished line instead of passing it silently.
function sketchWith(constraints: ConstrainedSketch2d['constraints']): ConstrainedSketch2d {
  return {
    version: 1,
    name: 'Line',
    parameters: [],
    points: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 30, y: 4 },
    ],
    lines: [{ id: 'edge', first: 'a', second: 'b' }],
    circles: [],
    profiles: [],
    constraints,
  };
}

function reviewText(sketch: ConstrainedSketch2d): string {
  const result = solveConstrainedSketch(sketch);
  return renderToStaticMarkup(<SketchSolveReview result={result} review={null} stale={false} />);
}

describe('SketchSolveReview', () => {
  it('warns when a solved line has no length', () => {
    const html = reviewText(
      sketchWith([
        { id: 'flat', kind: 'horizontal', lineId: 'edge' },
        { id: 'upright', kind: 'vertical', lineId: 'edge' },
      ]),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('edge has no length after solving');
  });

  it('stays quiet for a line that keeps its length', () => {
    const html = reviewText(sketchWith([{ id: 'flat', kind: 'horizontal', lineId: 'edge' }]));
    expect(html).not.toContain('no length after solving');
  });
});
