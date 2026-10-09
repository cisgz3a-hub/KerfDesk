import { Color, type ColorRepresentation } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createViewer3dRenderScheduler } from './create-viewer3d-render-scheduler';
import { preserveViewer3dClearColor } from './viewer3d-context';

function fixture(canvas = document.createElement('canvas')) {
  const current = new Color(0x1c1f24);
  let alpha = 1;
  const order: string[] = [];
  const requestRender = vi.fn(() => order.push('request-render'));
  const renderer = {
    domElement: canvas,
    getClearColor: vi.fn((target: Color) => {
      order.push('read-colour');
      return target.copy(current);
    }),
    getClearAlpha: vi.fn(() => {
      order.push('read-alpha');
      return alpha;
    }),
    setClearColor: vi.fn((color: ColorRepresentation, nextAlpha = 1) => {
      order.push('apply-colour');
      current.set(color);
      alpha = nextAlpha;
    }),
  };
  // Three installs this non-capture listener in its constructor, before ours.
  const engineReset = vi.fn(() => {
    order.push('engine-reset');
    current.setHex(0);
    alpha = 1;
  });
  canvas.addEventListener('webglcontextrestored', engineReset);
  const dispose = preserveViewer3dClearColor(renderer, new Color(), requestRender);
  return { canvas, current, renderer, requestRender, engineReset, dispose, order };
}

describe('viewer clear colour restoration', () => {
  it('copies current colour and alpha before the engine reset and requests a frame afterwards', () => {
    const f = fixture();
    const configured = new Color(0x2a3440);
    try {
      f.renderer.setClearColor(configured, 0.7);
      f.order.length = 0;
      // A real WebGL restoration event does not bubble.
      f.canvas.dispatchEvent(new Event('webglcontextrestored', { bubbles: false }));
      expect(f.order).toEqual([
        'read-colour',
        'read-alpha',
        'engine-reset',
        'apply-colour',
        'request-render',
      ]);
      expect(f.engineReset).toHaveBeenCalledOnce();
      expect(f.current.equals(configured)).toBe(true);
      expect(f.renderer.getClearAlpha()).toBe(0.7);
      expect(f.requestRender).toHaveBeenCalledOnce();
    } finally {
      f.dispose();
    }
  });

  it('preserves configuration changed while lost across repeated restorations', () => {
    const f = fixture();
    try {
      for (const [index, color] of [0x2a3440, 0x1c1f24, 0x6c5140].entries()) {
        f.canvas.dispatchEvent(new Event('webglcontextlost'));
        const configured = new Color(color);
        f.renderer.setClearColor(configured, index / 3);
        f.canvas.dispatchEvent(new Event('webglcontextrestored'));
        expect(f.current.equals(configured)).toBe(true);
        expect(f.renderer.getClearAlpha()).toBe(index / 3);
      }
      expect(f.requestRender).toHaveBeenCalledTimes(3);
    } finally {
      f.dispose();
    }
  });

  it('removes both listeners before renderer and scheduler disposal', () => {
    const f = fixture();
    f.dispose();
    f.renderer.setClearColor(new Color(0x2a3440), 0.5);
    f.renderer.getClearColor.mockClear();
    f.renderer.getClearAlpha.mockClear();
    f.renderer.setClearColor.mockClear();
    f.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(f.engineReset).toHaveBeenCalledOnce();
    expect(f.current.getHex()).toBe(0);
    expect(f.renderer.getClearColor).not.toHaveBeenCalled();
    expect(f.renderer.getClearAlpha).not.toHaveBeenCalled();
    expect(f.renderer.setClearColor).not.toHaveBeenCalled();
    expect(f.requestRender).not.toHaveBeenCalled();
  });

  it('does not retain the old renderer when the connected canvas is reused', () => {
    const previous = fixture();
    previous.dispose();
    previous.canvas.removeEventListener('webglcontextrestored', previous.engineReset);
    previous.renderer.getClearColor.mockClear();
    const next = fixture(previous.canvas);
    try {
      next.renderer.setClearColor(new Color(0x6c5140), 0.4);
      next.canvas.dispatchEvent(new Event('webglcontextrestored'));
      expect(next.current.getHex()).toBe(0x6c5140);
      expect(next.renderer.getClearAlpha()).toBe(0.4);
      expect(next.requestRender).toHaveBeenCalledOnce();
      expect(previous.renderer.getClearColor).not.toHaveBeenCalled();
      expect(previous.requestRender).not.toHaveBeenCalled();
    } finally {
      next.dispose();
    }
  });

  it('coalesces restoration frames and cancels the pending frame before teardown', () => {
    const f = fixture();
    f.dispose();
    const requestFrame = vi.fn(() => 17);
    const cancelFrame = vi.fn();
    const render = vi.fn();
    const scheduler = createViewer3dRenderScheduler({
      render,
      frameApi: { requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame },
    });
    const dispose = preserveViewer3dClearColor(f.renderer, new Color(), scheduler.requestRender);
    try {
      f.canvas.dispatchEvent(new Event('webglcontextrestored'));
      f.canvas.dispatchEvent(new Event('webglcontextrestored'));
      expect(scheduler.getRevision()).toBe(2);
      expect(requestFrame).toHaveBeenCalledOnce();
      dispose();
      scheduler.dispose();
      expect(cancelFrame).toHaveBeenCalledWith(17);
      f.canvas.dispatchEvent(new Event('webglcontextrestored'));
      expect(scheduler.getRevision()).toBe(2);
      expect(requestFrame).toHaveBeenCalledOnce();
      expect(render).not.toHaveBeenCalled();
    } finally {
      dispose();
      scheduler.dispose();
    }
  });
});
