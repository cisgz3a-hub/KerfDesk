import { type LaserController } from '../controllers/ControllerInterface';

export const FRAME_IDLE_POLL_MS = 200;

/**
 * Legacy fixed-timeout default. Used for non-frame paths and as the
 * floor for {@link estimateFrameIdleTimeoutMs}. Tests can pass an
 * override directly to {@link waitForGrblIdle}.
 *
 * Increased from 15_000 to 60_000 in T1-98 because the previous value
 * could expire before larger frame paths finished traveling, causing
 * `frameSafe` to return `{ok:false, reason:'idle-timeout'}` even though
 * the laser physically completed the frame trace.
 */
export const FRAME_IDLE_TIMEOUT_MS = 60_000;

/**
 * T1-98: dynamic frame idle timeout based on actual corner travel.
 *
 * The total path length walks the corner sequence and divides by a
 * conservative assumed feed rate to get expected travel time, then
 * doubles it and adds a 5s GRBL idle-reporting margin.
 */
export function estimateFrameIdleTimeoutMs(
  corners: readonly { x: number; y: number }[],
): number {
  if (corners.length < 2) return 30_000;
  let distance = 0;
  for (let i = 1; i < corners.length; i++) {
    distance += Math.hypot(
      corners[i]!.x - corners[i - 1]!.x,
      corners[i]!.y - corners[i - 1]!.y,
    );
  }
  const assumedFeedMmPerMin = 3000;
  const expectedMs = (distance / assumedFeedMmPerMin) * 60_000;
  return Math.max(30_000, Math.ceil(expectedMs * 2 + 5_000));
}

/**
 * Poll until GRBL reports idle (e.g. after framing moves).
 * @param timeoutMs — defaults to {@link FRAME_IDLE_TIMEOUT_MS}; use a smaller value in tests.
 */
export async function waitForGrblIdle(
  ctrl: LaserController,
  timeoutMs: number = FRAME_IDLE_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      ctrl.requestStatusReport();
    } catch {
      /* disconnected */
    }
    if (ctrl.state.status === 'idle') return true;
    await new Promise<void>(r => setTimeout(r, FRAME_IDLE_POLL_MS));
  }
  return false;
}
