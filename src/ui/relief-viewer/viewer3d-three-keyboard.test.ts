import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  installViewer3DThreeKeyboard,
  type Viewer3DThreeKeyboardControls,
} from './viewer3d-three-keyboard';

describe('installViewer3DThreeKeyboard', () => {
  it('scopes OrbitControls keys to the canvas and adds plus/minus zoom', () => {
    const canvas = document.createElement('canvas');
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);
    const controls = fakeControls();
    const dispose = installViewer3DThreeKeyboard(canvas, camera, controls);

    expect(controls.listenToKeyEvents).toHaveBeenCalledWith(canvas);
    const zoomIn = keydown(canvas, '+');
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(camera.position.distanceTo(controls.target)).toBeLessThan(10);
    expect(controls.update).toHaveBeenCalledOnce();

    dispose();
    expect(controls.stopListenToKeyEvents).toHaveBeenCalledOnce();
    const distance = camera.position.distanceTo(controls.target);
    keydown(canvas, '-');
    expect(camera.position.distanceTo(controls.target)).toBe(distance);
  });

  it('does not let OrbitControls or custom zoom consume host modifier chords', () => {
    const canvas = document.createElement('canvas');
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);
    const controls = fakeControls();
    const dispose = installViewer3DThreeKeyboard(canvas, camera, controls);

    const browserZoom = keydown(canvas, '+', { ctrlKey: true });
    expect(browserZoom.defaultPrevented).toBe(false);
    controls.delegatedKeyDown.mockClear();
    const browserNavigation = keydown(canvas, 'ArrowLeft', { altKey: true });
    expect(browserNavigation.defaultPrevented).toBe(false);
    expect(controls.delegatedKeyDown).not.toHaveBeenCalled();
    expect(camera.position.distanceTo(controls.target)).toBe(10);
    dispose();
  });
});

function fakeControls(): Viewer3DThreeKeyboardControls & {
  readonly listenToKeyEvents: ReturnType<typeof vi.fn>;
  readonly stopListenToKeyEvents: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
  readonly delegatedKeyDown: ReturnType<typeof vi.fn>;
} {
  let keyTarget: HTMLElement | Window | null = null;
  const delegatedKeyDown = vi.fn((event: Event) => {
    if (event instanceof KeyboardEvent && event.key.startsWith('Arrow')) event.preventDefault();
  });
  return {
    enabled: true,
    target: new Vector3(),
    minDistance: 0,
    maxDistance: Number.POSITIVE_INFINITY,
    listenToKeyEvents: vi.fn((element: HTMLElement | Window) => {
      keyTarget = element;
      element.addEventListener('keydown', delegatedKeyDown);
    }),
    stopListenToKeyEvents: vi.fn(() => {
      keyTarget?.removeEventListener('keydown', delegatedKeyDown);
      keyTarget = null;
    }),
    update: vi.fn(() => true),
    delegatedKeyDown,
  };
}

function keydown(
  canvas: HTMLCanvasElement,
  key: string,
  init: Pick<KeyboardEventInit, 'altKey' | 'ctrlKey' | 'metaKey'> = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  canvas.dispatchEvent(event);
  return event;
}
