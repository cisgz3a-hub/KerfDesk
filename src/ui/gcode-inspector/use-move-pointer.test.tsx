import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3dSceneHandle } from '../viewer3d';
import { useMovePointer } from './use-move-pointer';

const pick = { segmentIndex: 1, fraction: 0.5, point: { x: 20, y: 0, z: 0 } };
let host: HTMLDivElement;
let root: Root;
let canvas: HTMLCanvasElement;
const locate = vi.fn();
const pickMove = vi.fn(() => pick);

function Harness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef({ pickMove, highlightMove: vi.fn() } as unknown as Viewer3dSceneHandle);
  useMovePointer({
    canvasRef,
    handleRef,
    enabled: true,
    paused: true,
    resetKey: 1,
    onLocate: locate,
  });
  return <canvas ref={canvasRef} />;
}

function pointer(type: string, x: number, y = 100, id = 7): void {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    bubbles: true,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  act(() => {
    canvas.dispatchEvent(event);
  });
}

beforeEach(async () => {
  locate.mockClear();
  pickMove.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  canvas = host.querySelector('canvas')!;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('move pointer click ownership while camera drag pauses hover', () => {
  it.each([100, 104])(
    'locates a click whose whole gesture stays within four pixels (%s)',
    (end) => {
      pointer('pointerdown', 100);
      pointer('pointermove', end);
      pointer('pointerup', end);
      expect(locate).toHaveBeenCalledExactlyOnceWith(pick);
    },
  );

  it.each([100, 102])('does not locate after a drag returns near its start (%s)', (end) => {
    pointer('pointerdown', 100);
    pointer('pointermove', 140);
    pointer('pointermove', end);
    pointer('pointerup', end);
    expect(pickMove).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
  });

  it('rejects a distant release even when no move event was delivered', () => {
    pointer('pointerdown', 100);
    pointer('pointerup', 140);
    expect(locate).not.toHaveBeenCalled();
  });

  it('retires a cancelled press before a later pointerup', () => {
    pointer('pointerdown', 100);
    pointer('pointercancel', 100);
    pointer('pointerup', 100);
    expect(locate).not.toHaveBeenCalled();
  });

  it('allows a new click after a dragged gesture ends', () => {
    pointer('pointerdown', 100);
    pointer('pointermove', 140);
    pointer('pointerup', 100);
    pointer('pointerdown', 100);
    pointer('pointerup', 100);
    expect(locate).toHaveBeenCalledExactlyOnceWith(pick);
  });

  it('does not treat another pointer movement as this press dragging', () => {
    pointer('pointerdown', 100);
    pointer('pointermove', 140, 100, 8);
    pointer('pointerup', 100);
    expect(locate).toHaveBeenCalledExactlyOnceWith(pick);
  });
});
