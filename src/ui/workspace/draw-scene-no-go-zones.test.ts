import { describe, expect, it } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { drawScene } from './draw-scene';

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly fillRectStyles: string[];
} {
  let fillStyle = '';
  const fillRectStyles: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillRect') {
          return () => {
            fillRectStyles.push(fillStyle);
          };
        }
        if (prop === 'measureText') return () => ({ width: 280 });
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = String(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, fillRectStyles };
}

function projectWithNoGoZone(): Project {
  const project = createProject();
  return {
    ...project,
    device: {
      ...project.device,
      noGoZones: [
        {
          id: 'front-clamp',
          name: 'Front clamp',
          enabled: true,
          x: 10,
          y: 392,
          width: 20,
          height: 4,
        },
      ],
    },
  };
}

describe('drawScene no-go zone overlay', () => {
  it('renders enabled profile safety zones above the grid', () => {
    const { ctx, fillRectStyles } = recordingContext();

    drawScene(ctx, 800, 600, projectWithNoGoZone(), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(fillRectStyles).toContain('rgba(198, 40, 40, 0.12)');
  });
});
