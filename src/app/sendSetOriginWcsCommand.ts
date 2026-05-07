import type { OperationResult } from '../controllers/ControllerInterface';

interface SetOriginController {
  operations: {
    setWorkOriginAtCurrentPosition(): Promise<OperationResult>;
  };
}

/**
 * LightBurn-style "Set Origin": zero G54 at the current physical head position.
 * Persists via G10 L20 (not volatile G92).
 */
export async function sendSetOriginWcsCommand(
  controller: SetOriginController | null | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  if (!controller || typeof controller.operations?.setWorkOriginAtCurrentPosition !== 'function') {
    return { ok: false, reason: 'no-controller' };
  }
  try {
    return await controller.operations.setWorkOriginAtCurrentPosition();
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
