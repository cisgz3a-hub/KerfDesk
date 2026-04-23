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
export function sendResetWcsCommand(
  controller: { sendCommand(s: string): void } | null | undefined,
): void {
  if (!controller || typeof controller.sendCommand !== 'function') return;
  try {
    controller.sendCommand('G10 L2 P1 X0 Y0 Z0');
  } catch {
    /* ignore blocked / disconnected */
  }
}
