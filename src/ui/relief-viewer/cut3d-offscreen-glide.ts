// The short glide after a Cut 3D drag (ADR-426). Every other 3D view glides
// through its orbit controls' damping. Cut 3D's camera lives in its offscreen
// worker and moves only by the deltas the page sends, so after the pointer
// lets go the page keeps sending a fading share of the drag's last speed,
// frame by frame, until it settles. The fade is the shared damping factor, so
// a flick travels as far as it does in the Inspector.

import { prefersReducedMotion, VIEWER3D_DAMPING_FACTOR } from '../viewer3d/viewer3d-controls';

export type Cut3DGlideKind = 'pan' | 'rotate';

export type Cut3DGlide = {
  /** Starts a drag: forgets the last one and ends any glide still running. */
  readonly begin: () => void;
  /** Records one drag step. */
  readonly track: (deltaX: number, deltaY: number) => void;
  /** The pointer let go: glides on at the drag's last speed, fading out. */
  readonly release: (kind: Cut3DGlideKind) => void;
  /** Ends a running glide at once (a new drag, a wheel step, a key). */
  readonly stop: () => void;
};

type FrameApi = Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
type Sample = {
  readonly atMs: number;
  readonly spanMs: number;
  readonly dx: number;
  readonly dy: number;
};

const FRAME_MS = 1000 / 60;
// Only the last moments of a drag set the glide's speed.
const SPEED_WINDOW_MS = 80;
// A drag held still this long before letting go ends without a glide.
const STILL_MS = 60;
const SETTLED_PX_PER_FRAME = 0.05;

export function createCut3DGlide(
  send: (kind: Cut3DGlideKind, deltaX: number, deltaY: number) => void,
  now: () => number = () => performance.now(),
  frames: FrameApi = globalThis,
): Cut3DGlide {
  let samples: Sample[] = [];
  let lastEventMs = 0;
  let frameId: number | null = null;
  const stop = (): void => {
    if (frameId !== null) frames.cancelAnimationFrame(frameId);
    frameId = null;
  };
  const glide = (kind: Cut3DGlideKind, speedX: number, speedY: number): void => {
    let vx = speedX;
    let vy = speedY;
    let previous = now();
    const step = (): void => {
      const current = now();
      const elapsed = Math.max(0, current - previous);
      previous = current;
      const fade = (1 - VIEWER3D_DAMPING_FACTOR) ** (elapsed / FRAME_MS);
      vx *= fade;
      vy *= fade;
      if (Math.hypot(vx, vy) * FRAME_MS < SETTLED_PX_PER_FRAME) {
        frameId = null;
        return;
      }
      send(kind, vx * elapsed, vy * elapsed);
      frameId = frames.requestAnimationFrame(step);
    };
    frameId = frames.requestAnimationFrame(step);
  };
  return {
    begin: () => {
      stop();
      samples = [];
      lastEventMs = now();
    },
    track: (deltaX, deltaY) => {
      const nowMs = now();
      samples.push({ atMs: nowMs, spanMs: nowMs - lastEventMs, dx: deltaX, dy: deltaY });
      lastEventMs = nowMs;
      samples = samples.filter((sample) => sample.atMs >= nowMs - SPEED_WINDOW_MS);
    },
    release: (kind) => {
      const nowMs = now();
      stop();
      const recent = samples.filter((sample) => sample.atMs >= nowMs - SPEED_WINDOW_MS);
      samples = [];
      if (prefersReducedMotion() || nowMs - lastEventMs > STILL_MS) return;
      const spanMs = recent.reduce((sum, sample) => sum + sample.spanMs, 0);
      if (spanMs <= 0) return;
      const dx = recent.reduce((sum, sample) => sum + sample.dx, 0);
      const dy = recent.reduce((sum, sample) => sum + sample.dy, 0);
      glide(kind, dx / spanMs, dy / spanMs);
    },
    stop,
  };
}
