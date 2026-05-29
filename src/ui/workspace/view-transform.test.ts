import { describe, expect, it } from 'vitest';
import { computeView, zoomAtCursorPx } from './view-transform';

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

describe('zoomAtCursorPx', () => {
  const CANVAS = { width: 800, height: 600 };
  const BED = { width: 400, height: 400 };

  // Helper: scene-mm under a canvas pixel for a given view.
  function sceneAtPx(
    px: { x: number; y: number },
    view: { zoomFactor: number; panX: number; panY: number },
  ) {
    const v = computeView(CANVAS.width, CANVAS.height, BED.width, BED.height, view);
    return { x: (px.x - v.offsetX) / v.scale, y: (px.y - v.offsetY) / v.scale };
  }

  it('keeps the scene point under the cursor fixed across a zoom in', () => {
    const view = { zoomFactor: 1, panX: 0, panY: 0 };
    const cursor = { x: 600, y: 200 }; // top-right-ish
    const sceneBefore = sceneAtPx(cursor, view);
    const next = zoomAtCursorPx({ cursorPx: cursor, factor: 2, canvas: CANVAS, bed: BED, view });
    const sceneAfter = sceneAtPx(cursor, next);
    expect(sceneAfter.x).toBeCloseTo(sceneBefore.x, 6);
    expect(sceneAfter.y).toBeCloseTo(sceneBefore.y, 6);
  });

  it('keeps the scene point under the cursor fixed across a zoom out', () => {
    const view = { zoomFactor: 1, panX: 0, panY: 0 };
    const cursor = { x: 100, y: 500 }; // bottom-left-ish
    const sceneBefore = sceneAtPx(cursor, view);
    const next = zoomAtCursorPx({ cursorPx: cursor, factor: 0.5, canvas: CANVAS, bed: BED, view });
    const sceneAfter = sceneAtPx(cursor, next);
    expect(sceneAfter.x).toBeCloseTo(sceneBefore.x, 6);
    expect(sceneAfter.y).toBeCloseTo(sceneBefore.y, 6);
  });

  it('preserves the anchor invariant when the view is already panned', () => {
    const view = { zoomFactor: 1.5, panX: 30, panY: -10 };
    const cursor = { x: 350, y: 280 };
    const sceneBefore = sceneAtPx(cursor, view);
    const next = zoomAtCursorPx({ cursorPx: cursor, factor: 1.4, canvas: CANVAS, bed: BED, view });
    const sceneAfter = sceneAtPx(cursor, next);
    expect(sceneAfter.x).toBeCloseTo(sceneBefore.x, 6);
    expect(sceneAfter.y).toBeCloseTo(sceneBefore.y, 6);
  });

  it('multiplies zoomFactor by the factor', () => {
    const view = { zoomFactor: 1.2, panX: 0, panY: 0 };
    const next = zoomAtCursorPx({
      cursorPx: { x: 400, y: 300 },
      factor: 1.1,
      canvas: CANVAS,
      bed: BED,
      view,
    });
    expect(next.zoomFactor).toBeCloseTo(1.2 * 1.1);
  });
});
