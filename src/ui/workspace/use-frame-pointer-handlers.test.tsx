import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFramePointerHandlers } from './use-frame-pointer-handlers';
import type { OwnedPointerHandlers } from './workspace-pointer-owner';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let handlers: OwnedPointerHandlers;
let cancelPending: () => void;
const activePointerId = { current: null as number | null };
const delivered: number[] = [];
const finished: number[][] = [];

function Harness({ enabled = true, epoch = 1 }: { enabled?: boolean; epoch?: number }): null {
  const cancel = useRef<() => void>(() => undefined);
  handlers = useFramePointerHandlers(
    {
      onPointerDown: (event) => {
        activePointerId.current = event.pointerId;
      },
      onPointerMove: (event) => {
        delivered.push(event.clientX);
      },
      onPointerUp: () => {
        finished.push([...delivered]);
        activePointerId.current = null;
      },
      onPointerCancel: () => {
        activePointerId.current = null;
      },
      onLostPointerCapture: () => {
        activePointerId.current = null;
      },
      onPointerLeave: vi.fn(),
    },
    enabled,
    activePointerId,
    cancel,
    epoch,
  );
  cancelPending = () => cancel.current();
  return null;
}

function pointer(x: number, pointerId = 1): Parameters<OwnedPointerHandlers['onPointerMove']>[0] {
  return { clientX: x, pointerId } as Parameters<OwnedPointerHandlers['onPointerMove']>[0];
}

function paint(): void {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}

beforeEach(async () => {
  frames = new Map();
  nextFrame = 0;
  delivered.length = 0;
  finished.length = 0;
  activePointerId.current = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('frame scheduled path editing pointers', () => {
  it('reduces a burst to the latest position once per paint', () => {
    for (let x = 1; x <= 100; x += 1) handlers.onPointerMove(pointer(x));
    expect(delivered).toEqual([]);
    expect(frames.size).toBe(1);
    paint();
    expect(delivered).toEqual([100]);
    handlers.onPointerMove(pointer(101));
    paint();
    expect(delivered).toEqual([100, 101]);
  });

  it('applies the final queued position before committing pointer-up', () => {
    handlers.onPointerDown(pointer(0));
    handlers.onPointerMove(pointer(10));
    handlers.onPointerMove(pointer(20));
    handlers.onPointerUp(pointer(20));
    expect(finished).toEqual([[20]]);
    expect(frames.size).toBe(0);
    paint();
    expect(delivered).toEqual([20]);
  });

  it('ignores a second pointer without replacing the owner position', () => {
    handlers.onPointerDown(pointer(0));
    handlers.onPointerMove(pointer(10));
    handlers.onPointerMove(pointer(99, 2));
    // The raw ownership handler ignores foreign releases; do not flush their queued movement.
    expect(frames.size).toBe(1);
    paint();
    expect(delivered).toEqual([10]);
  });

  it('flushes hover before node shortcuts and drops it before Escape', () => {
    handlers.onPointerMove(pointer(10));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    expect(delivered).toEqual([10]);
    handlers.onPointerMove(pointer(20));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    paint();
    expect(delivered).toEqual([10]);
  });

  it('keeps keyboard flush ahead of node shortcuts after document replacement', async () => {
    const observed: number[][] = [];
    const shortcut = (): void => {
      observed.push([...delivered]);
    };
    window.addEventListener('keydown', shortcut, true);
    try {
      await act(async () => root.render(<Harness epoch={2} />));
      handlers.onPointerMove(pointer(42));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
      expect(observed).toEqual([[42]]);
    } finally {
      window.removeEventListener('keydown', shortcut, true);
    }
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'] as const)(
    'drops pending movement on %s',
    (method) => {
      handlers.onPointerDown(pointer(0));
      handlers.onPointerMove(pointer(10));
      handlers[method](pointer(10));
      paint();
      expect(delivered).toEqual([]);
    },
  );

  it('cancels a queued hover on leaving the canvas, but preserves a captured drag', () => {
    handlers.onPointerMove(pointer(10));
    handlers.onPointerLeave(pointer(10));
    paint();
    expect(delivered).toEqual([]);
    handlers.onPointerDown(pointer(0));
    handlers.onPointerMove(pointer(20));
    handlers.onPointerLeave(pointer(20));
    paint();
    expect(delivered).toEqual([20]);
  });

  it('drops queued edits on Escape cancellation, document replacement, exit and unmount', async () => {
    handlers.onPointerMove(pointer(10));
    cancelPending();
    paint();
    expect(delivered).toEqual([]);
    handlers.onPointerMove(pointer(20));
    await act(async () => root.render(<Harness epoch={2} />));
    paint();
    expect(delivered).toEqual([]);
    handlers.onPointerMove(pointer(30));
    await act(async () => root.render(<Harness enabled={false} epoch={2} />));
    paint();
    expect(delivered).toEqual([]);
    await act(async () => root.render(<Harness />));
    handlers.onPointerMove(pointer(40));
    await act(async () => root.render(null));
    paint();
    expect(delivered).toEqual([]);
  });
});
