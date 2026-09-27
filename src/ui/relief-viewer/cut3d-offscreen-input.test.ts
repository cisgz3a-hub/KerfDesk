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

describe('Cut 3D wheel zoom', () => {
  it('zooms toward the pointer (ADR-426)', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.getBoundingClientRect = () => new DOMRect(100, 50, 400, 200);
    const onControl = vi.fn();
    const input = createCut3DOffscreenInput(canvas, onControl, vi.fn());
    input.start();

    const wheel = new WheelEvent('wheel', {
      deltaY: -120,
      clientX: 400,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(onControl).toHaveBeenLastCalledWith({
      kind: 'zoom',
      deltaY: -120,
      cursor: { ndcX: expect.closeTo(0.5), ndcY: expect.closeTo(0.5) },
    });
    input.dispose();
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
