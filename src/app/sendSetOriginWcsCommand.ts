/**
 * LightBurn-style "Set Origin": zero G54 at the current physical head position.
 * Persists via G10 L20 (not volatile G92).
 */
export function sendSetOriginWcsCommand(
  controller: { sendCommand(s: string, source?: 'internal' | 'user'): void } | null | undefined,
): void {
  if (!controller || typeof controller.sendCommand !== 'function') return;
  try {
    controller.sendCommand('G10 L20 P1 X0 Y0', 'internal');
  } catch {
    /* ignore blocked / disconnected */
  }
}
