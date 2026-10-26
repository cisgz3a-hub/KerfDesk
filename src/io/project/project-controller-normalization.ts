import { normalizeAutofocusCommand } from '../../core/devices/autofocus-command';
import { isControllerCommandSet, isKnownControllerKind } from '../../core/devices/device-profile';

// Unknown families and vendor command contracts must not reach driver lookup.
// Older project files retain the generic GRBL default when these are absent.
export function normalizeControllerPatch(dev: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (dev['controllerKind'] !== undefined && !isKnownControllerKind(dev['controllerKind'])) {
    patch['controllerKind'] = undefined;
  }
  if (
    dev['controllerCommandSet'] !== undefined &&
    !isControllerCommandSet(dev['controllerCommandSet'])
  ) {
    patch['controllerCommandSet'] = undefined;
  }
  const baud = dev['baudRate'];
  if (baud !== undefined && !(typeof baud === 'number' && Number.isFinite(baud) && baud > 0)) {
    patch['baudRate'] = undefined;
  }
  // The Auto-focus line is vetted like the positioning-light commands: a move,
  // burn or settings write is cleared, so the button is set up again
  // (ADR-400 Amendment 1, audit 13-P1-1).
  const autofocusCommand = normalizeAutofocusCommand(dev['autofocusCommand']);
  if (autofocusCommand !== dev['autofocusCommand']) {
    patch['autofocusCommand'] = autofocusCommand;
  }
  return patch;
}
