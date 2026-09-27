// Pointer side of move picking (ADR-470): hovering names the move under the
// pointer and outlines it; a click without a drag locates it. Picks run at
// most once a frame, and hovering pauses while a button is held or the camera
// moves, because the pick would chase a moving view. A click still counts
// then: pressing a button starts a (zero-length) camera drag too.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';

export type MoveHover = {
  readonly pick: Viewer3dPick;
  /** Pointer position over the canvas, CSS pixels from its top-left. */
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
};

type PointerAt = Omit<MoveHover, 'pick'>;

/** Farther than this between press and release is a pan, not a click. */
export const CLICK_SLOP_PX = 4;

export function useMovePointer(args: {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  /** False while the scene is not ready. */
  readonly enabled: boolean;
  /** True while the camera moves: hovering stops, clicks still locate. */
  readonly paused: boolean;
  /** Any change clears the hover: a new program has new moves. */
  readonly resetKey: unknown;
  readonly onLocate: (pick: Viewer3dPick) => void;
}): MoveHover | null {
  const { canvasRef, handleRef, enabled, paused, resetKey } = args;
  const [hover, setHover] = useState<MoveHover | null>(null);
  const locateRef = useRef(args.onLocate);
  const pausedRef = useRef(paused);
  const listenersRef = useRef<MoveListeners | null>(null);
  useEffect(() => {
    locateRef.current = args.onLocate;
  });
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) listenersRef.current?.clear();
  }, [paused]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || canvas === null) return;
    const listeners = createMoveListeners(canvas, {
      handleRef,
      setHover,
      locate: (pick) => locateRef.current(pick),
      isPaused: () => pausedRef.current,
    });
    listenersRef.current = listeners;
    canvas.addEventListener('pointermove', listeners.move);
    canvas.addEventListener('pointerleave', listeners.clear);
    canvas.addEventListener('pointerdown', listeners.down);
    canvas.addEventListener('pointerup', listeners.up);
    return () => {
      canvas.removeEventListener('pointermove', listeners.move);
      canvas.removeEventListener('pointerleave', listeners.clear);
      canvas.removeEventListener('pointerdown', listeners.down);
      canvas.removeEventListener('pointerup', listeners.up);
      listeners.clear();
      listenersRef.current = null;
    };
  }, [canvasRef, handleRef, enabled, resetKey]);
  return enabled && !paused ? hover : null;
}

type MoveListeners = ReturnType<typeof createMoveListeners>;

function createMoveListeners(
  canvas: HTMLCanvasElement,
  deps: {
    readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
    readonly setHover: (hover: MoveHover | null) => void;
    readonly locate: (pick: Viewer3dPick) => void;
    readonly isPaused: () => boolean;
  },
) {
  const { handleRef, setHover } = deps;
  let frame: number | null = null;
  let latest: PointerAt | null = null;
  let press: { readonly x: number; readonly y: number; readonly id: number } | null = null;
  const pointerAt = (event: PointerEvent): PointerAt => {
    const rect = canvas.getBoundingClientRect();
    return {
      xPx: event.clientX - rect.left,
      yPx: event.clientY - rect.top,
      widthPx: rect.width,
      heightPx: rect.height,
    };
  };
  const pickAt = (at: PointerAt): Viewer3dPick | null =>
    handleRef.current?.pickMove(at.xPx, at.yPx) ?? null;
  const clear = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    latest = null;
    handleRef.current?.highlightMove(null);
    setHover(null);
  };
  const update = (): void => {
    frame = null;
    if (latest === null || deps.isPaused()) return;
    const pick = pickAt(latest);
    handleRef.current?.highlightMove(pick?.segmentIndex ?? null);
    setHover(pick === null ? null : { pick, ...latest });
  };
  return {
    clear,
    move: (event: PointerEvent): void => {
      if (event.buttons !== 0 || deps.isPaused()) {
        if (latest !== null) clear();
        return;
      }
      latest = pointerAt(event);
      frame ??= requestAnimationFrame(update);
    },
    down: (event: PointerEvent): void => {
      press =
        event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    },
    up: (event: PointerEvent): void => {
      const start = press;
      press = null;
      if (start === null || event.button !== 0 || event.pointerId !== start.id) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
      const pick = pickAt(pointerAt(event));
      if (pick !== null) deps.locate(pick);
    },
  };
}
