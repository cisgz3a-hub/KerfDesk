import { describe, expect, it } from 'vitest';
import { computeView } from './view-transform';

describe('computeView', () => {
  it('fits the bed centered with PADDING_PX margin at zoomFactor=1', () => {
    const v = computeView(800, 600, 400, 400);
    // Square bed in landscape canvas → limited by height (552 usable / 400 = 1.38).
    expect(v.scale).toBeCloseTo(552 / 400);
    // Centered: (800 - 400*scale)/2 = (800 - 552)/2 = 124
    expect(v.offsetX).toBeCloseTo(124);
    expect(v.offsetY).toBeCloseTo(24);
  });

  it('applies zoomFactor multiplicatively over the fit-to-bed baseline', () => {
    const base = computeView(800, 600, 400, 400);
    const zoomed = computeView(800, 600, 400, 400, { zoomFactor: 2, panX: 0, panY: 0 });
    expect(zoomed.scale).toBeCloseTo(base.scale * 2);
  });

  it('applies pan in scene-mm, shifting the offsets by panX*scale, panY*scale', () => {
    const view = { zoomFactor: 1, panX: 10, panY: 5 };
    const v = computeView(800, 600, 400, 400, view);
    const baseV = computeView(800, 600, 400, 400);
    expect(v.offsetX - baseV.offsetX).toBeCloseTo(10 * baseV.scale);
    expect(v.offsetY - baseV.offsetY).toBeCloseTo(5 * baseV.scale);
  });
});
