// The WebGL2 overlay host (ADR-440) outside a GPU: it must decline cleanly
// where WebGL2 is missing, and survive context loss and bad frames without
// throwing. Pixel output is checked against the shader mirror in a real browser.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { overheadPose, wideLens } from '../../../core/camera/model/model-fixtures';
import { createBedOverlayRenderer } from './bed-overlay-renderer';
import { bedOverlayUniforms } from './bed-overlay-shader';

const UNIFORMS = bedOverlayUniforms({
  lens: wideLens(),
  pose: overheadPose(),
  surfaceHeightMm: 0,
  view: { scale: 2, offsetX: 10, offsetY: 10 },
  canvasWidthPx: 64,
  canvasHeightPx: 48,
  devicePixelRatio: 1,
  bedWidthMm: 400,
  bedHeightMm: 400,
  opacity: 1,
});

// A frame source is opaque to the renderer; the fake context never reads it.
const FRAME = {} as TexImageSource;

// Just enough WebGL2 for the renderer's calls: every method is a spy that
// returns a fresh handle, and constants read back as their own names.
function fakeWebgl2(): {
  gl: WebGL2RenderingContext;
  spy: (name: string) => ReturnType<typeof vi.fn>;
} {
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  const spy = (name: string): ReturnType<typeof vi.fn> => {
    const existing = spies.get(name);
    if (existing !== undefined) return existing;
    const created = vi.fn(() => ({}));
    spies.set(name, created);
    return created;
  };
  const fixed: Record<string, unknown> = {
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    drawingBufferWidth: 64,
    drawingBufferHeight: 48,
  };
  const gl = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== 'string') return undefined;
        if (prop in fixed) return fixed[prop];
        return /^[A-Z0-9_]+$/.test(prop) ? prop : spy(prop);
      },
    },
  );
  // Cast: a structural test double for the handful of WebGL2 calls the renderer makes.
  return { gl: gl as WebGL2RenderingContext, spy };
}

function canvasWith(context: WebGL2RenderingContext | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // Cast: getContext is overloaded per context id; this double answers every id.
  vi.spyOn(canvas, 'getContext').mockImplementation(
    () => context as unknown as ReturnType<HTMLCanvasElement['getContext']>,
  );
  return canvas;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBedOverlayRenderer', () => {
  it('returns null when the browser has no WebGL2 (jsdom)', () => {
    expect(createBedOverlayRenderer(document.createElement('canvas'))).toBeNull();
  });

  it('asks for a webgl2 context and returns null when it is refused', () => {
    const canvas = canvasWith(null);
    expect(createBedOverlayRenderer(canvas)).toBeNull();
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', expect.anything());
  });

  it('draws one full-screen triangle and sizes the backing store to the uniforms', () => {
    const { gl, spy } = fakeWebgl2();
    const canvas = canvasWith(gl);
    const renderer = createBedOverlayRenderer(canvas);
    renderer?.draw(FRAME, 1280, 720, UNIFORMS);
    expect(spy('drawArrays')).toHaveBeenCalledWith('TRIANGLES', 0, 3);
    expect([canvas.width, canvas.height]).toEqual([64, 48]);
  });

  it('clears instead of drawing when the frame is empty or cannot be uploaded', () => {
    const { gl, spy } = fakeWebgl2();
    const renderer = createBedOverlayRenderer(canvasWith(gl));
    renderer?.draw(FRAME, 0, 0, UNIFORMS);
    spy('texImage2D').mockImplementation(() => {
      throw new DOMException('tainted', 'SecurityError');
    });
    expect(() => renderer?.draw(FRAME, 1280, 720, UNIFORMS)).not.toThrow();
    expect(spy('drawArrays')).not.toHaveBeenCalled();
    expect(spy('clear')).toHaveBeenCalledTimes(2);
  });

  it('goes quiet on context loss and rebuilds on restore', () => {
    const { gl, spy } = fakeWebgl2();
    const canvas = canvasWith(gl);
    const renderer = createBedOverlayRenderer(canvas);
    const lostEvent = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lostEvent);
    expect(lostEvent.defaultPrevented).toBe(true);
    expect(renderer?.lost).toBe(true);
    renderer?.draw(FRAME, 1280, 720, UNIFORMS);
    expect(spy('drawArrays')).not.toHaveBeenCalled();

    const programsBefore = spy('createProgram').mock.calls.length;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(renderer?.lost).toBe(false);
    expect(spy('createProgram').mock.calls.length).toBe(programsBefore + 1);
    renderer?.draw(FRAME, 1280, 720, UNIFORMS);
    expect(spy('drawArrays')).toHaveBeenCalledTimes(1);
  });

  it('stops drawing and deletes its GPU objects on dispose', () => {
    const { gl, spy } = fakeWebgl2();
    const renderer = createBedOverlayRenderer(canvasWith(gl));
    renderer?.dispose();
    renderer?.draw(FRAME, 1280, 720, UNIFORMS);
    expect(spy('drawArrays')).not.toHaveBeenCalled();
    expect(spy('deleteProgram')).toHaveBeenCalledTimes(1);
    expect(spy('deleteTexture')).toHaveBeenCalledTimes(1);
  });
});
