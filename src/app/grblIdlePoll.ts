import { type LaserController } from '../controllers/ControllerInterface';

export const FRAME_IDLE_POLL_MS = 200;
export const FRAME_IDLE_TIMEOUT_MS = 15_000;

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
