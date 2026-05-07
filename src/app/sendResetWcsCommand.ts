import type { OperationResult } from '../controllers/ControllerInterface';

interface ResetWcsController {
  operations: {
    resetWcsToMachineOrigin(): Promise<OperationResult>;
  };
}

/**
 * Reset G54 work coordinate system to machine origin.
 * Used when leaving Origin mode so subsequent Bed/Head mode jobs
 * don't inherit a stuck WCS offset. Matches the post-connect
 * handshake behavior.
 *
 * Uses G10 L2 (absolute set) rather than G10 L20 (relative to
 * current position): we want WCS == machine coords regardless of
 * where the head happens to be.
 */
export async function sendResetWcsCommand(
  controller: ResetWcsController | null | undefined,
): Promise<void> {
  if (!controller || typeof controller.operations?.resetWcsToMachineOrigin !== 'function') return;
  try {
    await controller.operations.resetWcsToMachineOrigin();
  } catch {
    /* best-effort WCS cleanup */
  }
}
