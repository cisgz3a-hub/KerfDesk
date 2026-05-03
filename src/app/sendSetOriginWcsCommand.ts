/**
 * LightBurn-style "Set Origin": zero G54 at the current physical head position.
 * Persists via G10 L20 (not volatile G92).
 */
export function sendSetOriginWcsCommand(
  controller: { sendCommand(s: string, source?: 'internal' | 'user'): void } | null | undefined,
): { ok: boolean; reason?: string } {
  if (!controller || typeof controller.sendCommand !== 'function') {
    return { ok: false, reason: 'no-controller' };
  }
  try {
    controller.sendCommand('G10 L20 P1 X0 Y0', 'internal');
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
