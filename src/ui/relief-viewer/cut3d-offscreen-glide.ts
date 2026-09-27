// Cut 3D's camera lives in a worker without OrbitControls. Match their
// damping by applying a share of the remaining pointer displacement on each
// update, including while dragging. The glide consumes the rest of that same
// displacement; it must not add extrapolated travel after applying it in full.

import { prefersReducedMotion, VIEWER3D_DAMPING_FACTOR } from '../viewer3d/viewer3d-controls';

export type Cut3DGlideKind = 'pan' | 'rotate';

export type Cut3DGlide = {
  /** Starts a drag: forgets the last one and ends any glide still running. */
  readonly begin: () => void;
  /** Applies part of one drag step and lets its remaining displacement settle. */
  readonly track: (kind: Cut3DGlideKind, deltaX: number, deltaY: number) => void;
  /** Ends a running glide at once (a new drag, a wheel step, a key). */
  readonly stop: () => void;
};

type FrameApi = Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
// Consume the imperceptible tail exactly rather than leave the camera short
// of the pointer's requested distance or keep scheduling invisible frames.
const SETTLED_PX = 0.05;

export function createCut3DGlide(
  send: (kind: Cut3DGlideKind, deltaX: number, deltaY: number) => void,
  frames: FrameApi = globalThis,
): Cut3DGlide {
  let kind: Cut3DGlideKind | null = null;
  let remainingX = 0;
  let remainingY = 0;
  let frameId: number | null = null;
  const stop = (): void => {
    if (frameId !== null) frames.cancelAnimationFrame(frameId);
    frameId = null;
    kind = null;
    remainingX = remainingY = 0;
  };
  const step = (): void => {
    if (kind === null || (remainingX === 0 && remainingY === 0)) return;
    const share =
      prefersReducedMotion() || Math.hypot(remainingX, remainingY) <= SETTLED_PX
        ? 1
        : VIEWER3D_DAMPING_FACTOR;
    const dx = remainingX * share;
    const dy = remainingY * share;
    remainingX -= dx;
    remainingY -= dy;
    send(kind, dx, dy);
    if (frameId === null && (remainingX !== 0 || remainingY !== 0)) {
      frameId = frames.requestAnimationFrame(() => {
        frameId = null;
        step();
      });
    }
  };
  return {
    begin: stop,
    track: (nextKind, deltaX, deltaY) => {
      if (kind !== nextKind) stop();
      kind = nextKind;
      remainingX += deltaX;
      remainingY += deltaY;
      step();
    },
    stop,
  };
}
