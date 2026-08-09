import { describe, expect, it, vi } from 'vitest';
import { installViewer3DKeyboardInput } from './viewer3d-keyboard-input';

describe('installViewer3DKeyboardInput', () => {
  it('owns only recognized focused-canvas keys for its installed lifetime', () => {
    const canvas = document.createElement('canvas');
    const onControl = vi.fn();
    const dispose = installViewer3DKeyboardInput(canvas, onControl);

    expect(keydown(canvas, 'Tab').defaultPrevented).toBe(false);
    expect(keydown(canvas, 'ArrowDown').defaultPrevented).toBe(true);
    expect(onControl).toHaveBeenCalledOnce();

    dispose();
    expect(keydown(canvas, '+').defaultPrevented).toBe(false);
    expect(onControl).toHaveBeenCalledOnce();
  });
});

function keydown(canvas: HTMLCanvasElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  canvas.dispatchEvent(event);
  return event;
}
