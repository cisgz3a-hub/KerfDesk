// A port can open with nothing answering on it: the wrong baud, or another
// device's port. Machine Setup's strip then says "Your machine didn't answer",
// so the toolbar and the setup sidebar must not say "Connected" beside it
// (UX audit U2-P3-3). One test for all three.

import type { ControllerQualification } from './laser-controller-qualification';
import type { ConnectionState } from './laser-store';

export const PORT_OPEN_NO_ANSWER = 'Port open, no answer';
/** The toolbar's form. Its status line sits under the machine name, and a
 * failed read must not widen the row (ADR-642): the long form did by 2.5 px at
 * 1920 px, where "Reading settings…" already fits. */
export const NO_ANSWER_TOOLBAR = 'No answer';

export function portOpenWithoutAnswer(laser: {
  readonly connection: ConnectionState;
  readonly controllerQualification: ControllerQualification;
  readonly statusReport: unknown;
  readonly detectedControllerKind: string | null;
}): boolean {
  return (
    laser.connection.kind === 'connected' &&
    laser.controllerQualification.kind === 'failed' &&
    !controllerHeard(laser)
  );
}

export function controllerHeard(laser: {
  readonly statusReport: unknown;
  readonly detectedControllerKind: string | null;
}): boolean {
  return laser.statusReport !== null || laser.detectedControllerKind !== null;
}
