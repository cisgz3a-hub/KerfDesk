import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { drawRulers } from './draw-rulers';
import { canvasMouseToScene, computeView, type ViewState } from './view-transform';

type Label = { readonly text: string; readonly x: number; readonly y: number };

function recordRulers(width: number, height: number, viewState: ViewState) {
  const labels: Label[] = [];
  const fills: Array<{ width: number; height: number }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'fillText')
          return (text: string, x: number, y: number) => labels.push({ text, x, y });
        if (property === 'fillRect')
          return (_x: number, _y: number, width: number, height: number) =>
            fills.push({ width, height });
        return () => undefined;
      },
    },
  ) as CanvasRenderingContext2D;
  const view = computeView(width, height, 400, 400, viewState);
  drawRulers(ctx, width, height, view);
  return { labels, fills, view };
}

describe('workspace ruler alignment', () => {
  it.each([
    { zoomFactor: 1, panX: 0, panY: 0 },
    { zoomFactor: 1.5, panX: -30, panY: 20 },
  ])(
    'keeps ruler-labelled coordinates aligned with pointer hits after zoom and pan: %j',
    (state) => {
      const { labels } = recordRulers(800, 600, state);
      const xLabel = labels.find((label) => label.text === '100' && label.y === 2);
      const yLabel = labels.find((label) => label.text === '150' && label.x === 2);
      if (xLabel === undefined || yLabel === undefined) throw new Error('Missing ruler labels');
      // The label is offset two pixels from its tick. Exercise a CSS-scaled
      // canvas as well, so display coordinates and bitmap coordinates cannot drift.
      const canvas = {
        width: 800,
        height: 600,
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
      } as HTMLCanvasElement;
      const mouse = {
        clientX: 10 + (xLabel.x - 2) / 2,
        clientY: 20 + (yLabel.y - 2) / 2,
      } as React.MouseEvent<HTMLCanvasElement>;
      const point = canvasMouseToScene(mouse, canvas, createProject(), state);
      expect(point?.x).toBeCloseTo(100);
      expect(point?.y).toBeCloseTo(150);
    },
  );

  it.each([
    [800, 600],
    [600, 800],
  ])('keeps the fitted bed clear of both strips at %ix%i', (width, height) => {
    const { fills, view } = recordRulers(width, height, { zoomFactor: 1, panX: 0, panY: 0 });
    expect(view.offsetX).toBeGreaterThan(fills[1]?.width ?? Infinity);
    expect(view.offsetY).toBeGreaterThan(fills[0]?.height ?? Infinity);
  });
});
