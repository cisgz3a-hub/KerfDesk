import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCut3DOffscreenInput } from './cut3d-offscreen-input';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createCut3DOffscreenInput', () => {
  it('sends pan, orbit, and zoom controls from focused-canvas keyboard input', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const onControl = vi.fn();
    const input = createCut3DOffscreenInput(canvas, onControl, vi.fn());
    input.start();

    const pan = keydown(canvas, 'ArrowLeft');
    expect(pan.defaultPrevented).toBe(true);
    expect(onControl).toHaveBeenLastCalledWith({
      kind: 'pan',
      deltaX: expect.any(Number),
      deltaY: 0,
    });
    expect(lastDelta(onControl, 'deltaX')).toBeGreaterThan(0);

    const orbit = keydown(canvas, 'ArrowRight', true);
    expect(orbit.defaultPrevented).toBe(true);
    expect(onControl).toHaveBeenLastCalledWith({
      kind: 'rotate',
      deltaX: expect.any(Number),
      deltaY: 0,
    });
    expect(lastDelta(onControl, 'deltaX')).toBeLessThan(0);

    const zoom = keydown(canvas, '+');
    expect(zoom.defaultPrevented).toBe(true);
    expect(onControl).toHaveBeenLastCalledWith({
      kind: 'zoom',
      deltaY: expect.any(Number),
    });
    expect(lastDelta(onControl, 'deltaY')).toBeLessThan(0);

    input.dispose();
    const callCount = onControl.mock.calls.length;
    keydown(canvas, 'ArrowUp');
    expect(onControl).toHaveBeenCalledTimes(callCount);
  });
});

function keydown(canvas: HTMLCanvasElement, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  canvas.dispatchEvent(event);
  return event;
}

function lastDelta(mock: ReturnType<typeof vi.fn>, key: 'deltaX' | 'deltaY'): number {
  const control = mock.mock.lastCall?.[0] as Record<string, unknown> | undefined;
  const value = control?.[key];
  if (typeof value !== 'number') throw new Error(`Missing numeric ${key}`);
  return value;
}
