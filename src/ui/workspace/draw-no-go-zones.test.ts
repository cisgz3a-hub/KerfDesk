import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, type Project } from '../../core/scene';
import { drawScene } from './draw-scene';

function canvasContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly fillRects: number;
  readonly strokeRects: number;
} {
  const calls = { fillRects: 0, strokeRects: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillRect') {
          return () => {
            calls.fillRects++;
          };
        }
        if (prop === 'strokeRect') {
          return () => {
            calls.strokeRects++;
          };
        }
        if (prop === 'measureText') return () => ({ width: 0 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return {
    ctx,
    get fillRects() {
      return calls.fillRects;
    },
    get strokeRects() {
      return calls.strokeRects;
    },
  };
}

function projectWithZone(enabled: boolean): Project {
  return createProject({
    ...DEFAULT_DEVICE_PROFILE,
    noGoZones: [
      {
        id: 'clamp',
        name: 'Clamp',
        enabled,
        x: 20,
        y: 20,
        width: 10,
        height: 10,
      },
    ],
  });
}

describe('drawScene no-go zones', () => {
  it('renders enabled no-go zones as a workspace overlay', () => {
    const capture = canvasContext();

    drawScene(capture.ctx, 800, 600, projectWithZone(true), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(capture.fillRects).toBeGreaterThan(1);
    expect(capture.strokeRects).toBeGreaterThan(1);
  });

  it('does not render disabled zones', () => {
    const enabled = canvasContext();
    const disabled = canvasContext();

    drawScene(enabled.ctx, 800, 600, projectWithZone(true), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });
    drawScene(disabled.ctx, 800, 600, projectWithZone(false), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(enabled.fillRects).toBe(disabled.fillRects + 1);
    expect(enabled.strokeRects).toBe(disabled.strokeRects + 1);
  });
});
