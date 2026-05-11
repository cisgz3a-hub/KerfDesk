/**
 * T1-135: pure ticket-validation function extracted from
 * `MachineService.validateTicket`. Pre-T1-135 this method was a
 * private member of the 1924-line MachineService class — testing the
 * 4-gate validation logic (scene hash, profile hash, controller type,
 * gcode hash) required mounting the service AND stubbing the
 * `getActiveProfile()` singleton.
 *
 * Hoisting to a pure module:
 *   - separates the validation rule from the service-level
 *     orchestration that wraps it (token consumption, recovery gate,
 *     wifi gate, machine-state gate — all happen in startValidatedJob)
 *   - lets every gate be tested in isolation with synthetic inputs
 *   - documents the failure-reason strings as a stable surface (UI
 *     copy that the user sees verbatim when a gate trips)
 *
 * The four gates are independent — each tested in order so the
 * earliest mismatch wins. Order is also significant: scene-hash
 * mismatch is the most common (user edits between gcode generation
 * and Start click) and gets the most readable error copy; gcode-hash
 * mismatch is the diagnostic-only path (means the ticket itself is
 * corrupt — UI says "recompile to continue").
 */
import type { Scene } from '../core/scene/Scene';
import type { DeviceProfile } from '../core/devices/DeviceProfile';
import type { ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { hashObject, hashSceneForTicket, hashString } from '../core/job/ticketHashing';
import type { ControllerId } from '../controllers/ControllerRegistry';

/** Result of validating a `ValidatedJobTicket` against current state. */
export type TicketValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Inputs the validator needs. Pure — no `this`, no singletons. */
export interface ValidateJobTicketInput {
  ticket: ValidatedJobTicket;
  scene: Scene;
  /** The currently active device profile, or `null` when none is set. */
  currentProfile: DeviceProfile | null;
  /** Identifier of the currently connected controller type. */
  currentControllerType: ControllerId;
}

/**
 * Validate a `ValidatedJobTicket` against the current scene, profile,
 * and controller. Returns `{ ok: true }` when every gate passes, or
 * `{ ok: false, reason }` with a user-facing message at the first
 * mismatch. Gate order:
 *
 *   1. Scene hash — refuses when the design changed after gcode gen.
 *   2. Profile hash — refuses when the device profile changed.
 *   3. Controller type — refuses when the active controller changed.
 *   4. Gcode hash — refuses when the ticket itself is corrupted (a
 *      diagnostic-only path; means somebody mutated the ticket between
 *      compile and start).
 *
 * Each mismatch logs a diagnostic via `console.warn` with the
 * mismatched hashes. UI copy is the same as the pre-T1-135 inline
 * implementation.
 */
export function validateJobTicket(input: ValidateJobTicketInput): TicketValidationResult {
  const { ticket, scene, currentProfile, currentControllerType } = input;

  const currentSceneHash = hashSceneForTicket(scene);
  if (currentSceneHash !== ticket.sceneHash) {
    // T1-67: hashes stay in diagnostics, not in user-facing modal text.
    console.warn('[ticket] scene hash mismatch', {
      ticketHash: ticket.sceneHash,
      currentHash: currentSceneHash,
      ticketScenePreview: JSON.stringify(ticket).slice(0, 500),
    });
    return {
      ok: false,
      reason:
        'The design changed after this G-code was created. '
        + 'Update G-code, then frame again before starting.',
    };
  }

  const currentProfileHash = currentProfile
    ? hashObject(currentProfile)
    : hashString('no-profile');
  if (currentProfileHash !== ticket.profileHash) {
    console.warn('[ticket] profile hash mismatch', {
      ticketHash: ticket.profileHash,
      currentHash: currentProfileHash,
    });
    return {
      ok: false,
      reason:
        'The device profile changed after this G-code was created. '
        + 'Update G-code before starting.',
    };
  }

  if (currentControllerType !== ticket.controllerType) {
    console.warn('[ticket] controller type mismatch', {
      ticketControllerType: ticket.controllerType,
      currentControllerType,
    });
    return {
      ok: false,
      reason:
        'The controller type changed after this G-code was created. '
        + 'Update G-code before starting.',
    };
  }

  const recomputedGcodeHash = hashString(ticket.gcodeText);
  if (recomputedGcodeHash !== ticket.gcodeHash) {
    return {
      ok: false,
      reason: 'Ticket is corrupted (gcode hash mismatch). Recompile to continue.',
    };
  }

  return { ok: true };
}
