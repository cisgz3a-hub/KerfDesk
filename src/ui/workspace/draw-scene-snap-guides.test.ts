import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { drawScene } from './draw-scene';

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly strokeStyles: string[];
} {
  let strokeStyle = '';
  const strokeStyles: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'stroke') {
          return () => {
            strokeStyles.push(strokeStyle);
          };
        }
        if (prop === 'measureText') return () => ({ width: 280 });
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'strokeStyle') strokeStyle = String(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, strokeStyles };
}

describe('drawScene snap guide overlay', () => {
  it('renders transient snap guides above design artwork', () => {
    const { ctx, strokeStyles } = recordingContext();

    drawScene(ctx, 800, 600, createProject(), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
      snapGuides: [{ axis: 'x', positionMm: 20, fromMm: 0, toMm: 10 }],
    });

    expect(strokeStyles).toContain(canvasTheme.snapGuide);
  });
});
