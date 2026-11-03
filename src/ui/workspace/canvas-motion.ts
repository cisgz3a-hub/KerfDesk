// Which workspace frames are moving (ADR-346 Amendment 1). A frame is moving
// when the view panned or zoomed within the last MOTION_SETTLE_MS, or while a
// drag that has changed what it drags is held, and for MOTION_SETTLE_MS after
// it is released. The first frame after that quiet spell is the settled one:
// the workspace draws it again so artwork rests at its own stroke weight.
//
// A held drag does not settle between its steps. A slow frame (the GPU still
// busy) can leave more than the settle time between two steps, and a settled
// frame there would stroke the whole scene at full weight mid-drag, which is
// the slowest frame there is.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SPRITE_SETTLE_MS } from './artwork-sprite-cache';

/** Quiet time before a moved view counts as still: the sprites' settle time. */
export const MOTION_SETTLE_MS = SPRITE_SETTLE_MS;

export class CanvasMotion {
  private lastView: string | null = null;
  private lastDrag: ReadonlyArray<unknown> | null = null;
  private movedAt = Number.NEGATIVE_INFINITY;
  private dragMoved = false;

  /**
   * Records the frame about to be drawn and says whether it is moving.
   * `view` identifies the view; `drag` is what an active drag changes (the
   * project, the marquee), or null with no drag.
   */
  frame(view: string, drag: ReadonlyArray<unknown> | null, now: number): boolean {
    const viewMoved = this.lastView !== null && view !== this.lastView;
    const dragged = drag !== null && this.lastDrag !== null && !sameItems(drag, this.lastDrag);
    const released = drag === null && this.dragMoved;
    this.lastView = view;
    this.lastDrag = drag;
    if (dragged) this.dragMoved = true;
    if (released) this.dragMoved = false;
    if (viewMoved || dragged || released) this.movedAt = now;
    return this.moving(now);
  }

  moving(now: number): boolean {
    return this.dragMoved || now - this.movedAt < MOTION_SETTLE_MS;
  }

  /**
   * Milliseconds until the settled frame is due; 0 when it already is, null
   * while a moved drag is held (its release starts the settle time).
   */
  settlesIn(now: number): number | null {
    if (this.dragMoved) return null;
    return Math.max(0, this.movedAt + MOTION_SETTLE_MS - now);
  }
}

function sameItems(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * The workspace's motion tracker. `nextFrame` records the frame about to be
 * drawn; after a moving frame, `settledTick` changes once the view has been
 * still for the settle time, so the draw effect runs the settled frame.
 */
export function useCanvasMotion(): {
  readonly settledTick: number;
  readonly nextFrame: (
    view: { readonly zoomFactor: number; readonly panX: number; readonly panY: number },
    dragging: boolean,
    ...dragged: ReadonlyArray<unknown>
  ) => boolean;
} {
  const [motion] = useState(() => new CanvasMotion());
  const [settledTick, setSettledTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextFrame = useCallback(
    (
      view: { readonly zoomFactor: number; readonly panX: number; readonly panY: number },
      dragging: boolean,
      ...dragged: ReadonlyArray<unknown>
    ): boolean => {
      const now = performance.now();
      const key = `${view.zoomFactor}|${view.panX}|${view.panY}`;
      const moving = motion.frame(key, dragging ? dragged : null, now);
      if (!moving) return false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      const wait = motion.settlesIn(now);
      if (wait === null) return true;
      // A timer may fire a little early; the frame it runs then re-arms it.
      timer.current = setTimeout(() => {
        timer.current = null;
        setSettledTick((tick) => tick + 1);
      }, wait + 1);
      return true;
    },
    [motion],
  );
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { settledTick, nextFrame };
}
