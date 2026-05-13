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
import {
  fingerprintMismatchReason,
  type JobFingerprint,
} from '../core/job/JobFingerprint';
import { hashObject, hashSceneForTicket, hashString } from '../core/job/ticketHashing';
// T1-181 (external audit High #1 + #3): live-state hashes for the
// determinism gate. The validator recomputes these at start time and
// refuses if they diverge from the ticket's compile-time hashes.
import {
  captureEntitlementPolicySnapshot,
  hashEntitlementPolicy,
  hashReferencedMaterialPresets,
} from '../core/job/compileInputHashes';
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
  /**
   * T1-246: current runtime fingerprint rebuilt immediately before
   * start. Required on the production MachineService path; optional
   * here so older pure unit tests can still isolate pre-existing gates.
   */
  currentFingerprint?: JobFingerprint;
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

  // T1-181 (external audit High #1 + #3): determinism gates.
  //
  // Gate 5 (entitlement policy): the 6 feature flags read by
  // `JobCompiler.createEntitlementPolicy()` at compile time. A
  // license-state flip between compile and start could mean tabs /
  // overcut / lead-in / cross-hatch / power-scale / cut-start-point
  // were dropped during compile but are now active (or vice versa).
  const currentEntitlementHash = hashEntitlementPolicy(captureEntitlementPolicySnapshot());
  if (currentEntitlementHash !== ticket.entitlementPolicyHash) {
    console.warn('[ticket] entitlement policy hash mismatch', {
      ticketHash: ticket.entitlementPolicyHash,
      currentHash: currentEntitlementHash,
    });
    return {
      ok: false,
      reason:
        'License / feature entitlements changed after this G-code was created. '
        + 'Recompile so the toolpath reflects the current feature set, then start.',
    };
  }

  // Gate 6 (material presets): hash of every preset referenced by
  // a scene layer at compile time. A preset MUTATION (power curve
  // edit, speed change, response-curve adjustment) between compile
  // and start would silently change burn characteristics.
  const currentMaterialPresetsHash = hashReferencedMaterialPresets(scene);
  if (currentMaterialPresetsHash !== ticket.materialPresetsHash) {
    console.warn('[ticket] material presets hash mismatch', {
      ticketHash: ticket.materialPresetsHash,
      currentHash: currentMaterialPresetsHash,
    });
    return {
      ok: false,
      reason:
        'A material preset used by this design changed after the G-code was created. '
        + 'Recompile so the toolpath reflects the current preset settings, then start.',
    };
  }

  // T1-246: service-level stale-output gate. Earlier checks keep the
  // historical copy for scene/profile/material/gcode mismatches; this
  // full fingerprint catches the audit's missing runtime assumptions:
  // start mode, saved origin, resolved machine capabilities, and
  // compile options. A production start with a missing ticket
  // fingerprint is fail-closed.
  if (input.currentFingerprint) {
    const ticketFingerprint = (ticket as ValidatedJobTicket & {
      fingerprint?: JobFingerprint;
    }).fingerprint;
    if (!ticketFingerprint) {
      return {
        ok: false,
        reason:
          'Ticket is missing a job fingerprint. Recompile before starting.',
      };
    }
    const mismatch = fingerprintMismatchReason(ticketFingerprint, input.currentFingerprint);
    if (mismatch) {
      console.warn('[ticket] job fingerprint mismatch', {
        field: mismatch.field,
        ticketFingerprint,
        currentFingerprint: input.currentFingerprint,
      });
      return { ok: false, reason: mismatch.message };
    }
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
