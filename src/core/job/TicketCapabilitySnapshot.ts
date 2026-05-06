/**
 * T2-37: capability snapshot embedded in `ValidatedJobTicket`. Pre-
 * T2-37 the ticket carried `sceneHash + profileHash + gcodeHash +
 * controllerType` (T2-1's contract) — proving the user-editable
 * profile didn't change between compile and send, but NOT proving
 * that the LIVE controller settings (e.g. GRBL $30 max spindle)
 * still match the values the compiler USED.
 *
 * A ticket compiled with `$30=1000` can be sent unchanged to a
 * machine where `$30` has since become 255 (user reflashed
 * firmware, swapped controllers, edited via console). Audit 3C
 * Finding 7.2 + Required Priority 5.
 *
 * T2-37 ships the snapshot type + the per-field hash + the
 * mismatch reason builder. Threading the snapshot into
 * `ValidatedJobTicket` and `MachineService.startValidatedJob`'s
 * validator is filed as T2-37-followup so the existing T2-1
 * validation flow gets reviewed in one focused pass.
 *
 * Pairs with T2-25 (ControllerCapabilities, shipped in `73d83bc`)
 * — the snapshot is a `ControllerCapabilities` value frozen at
 * compile time + supplementary hashes covering the live $$ settings
 * and the controller identity ([VER:][OPT:]).
 */

import type { ControllerCapabilities } from '../../controllers/ControllerCapabilities';

/**
 * The fields T2-37 adds to ValidatedJobTicket. Independent file so
 * the ticket migration can adopt incrementally without yet altering
 * `src/core/job/ValidatedJobTicket.ts`.
 */
export interface TicketCapabilitySnapshot {
  /** FNV-1a 8-char hex of the capabilities object as JSON. */
  capabilitySnapshotHash: string;
  /** FNV-1a 8-char hex of the $$ settings dump (T2-110), or null. */
  settingsHash: string | null;
  /** FNV-1a 8-char hex of [VER:] + [OPT:] identity, or null. */
  controllerIdentityHash: string | null;
  /** Frozen capabilities the compile ran against. */
  capabilitiesUsed: ControllerCapabilities;
}

/**
 * Reasons a snapshot mismatch can fire. The user-facing UI ("re-
 * compile with current settings before running") routes off `kind`.
 */
export type CapabilityMismatchKind =
  | 'capabilities-changed'
  | 'controller-settings-changed'
  | 'controller-identity-changed'
  | 'max-spindle-changed'
  | 'bed-dimensions-changed'
  | 'laser-mode-changed'
  | 'execution-model-changed';

export interface CapabilityMismatchReason {
  kind: CapabilityMismatchKind;
  message: string;
  /** When applicable, the field that diverged + before/after values. */
  detail?: { field: string; before: unknown; after: unknown };
}

// ─── hashing ───────────────────────────────────────────────

function fnv1a32Hex(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (s.charCodeAt(i) >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
  return out;
}

/**
 * Hash any JSON-serialisable value. Stable across key-order
 * differences so two semantically-equal capabilities objects produce
 * the same hash.
 */
export function hashCapabilitiesValue(value: unknown): string {
  if (value == null) return 'none';
  return fnv1a32Hex(JSON.stringify(sortKeys(value)));
}

// ─── builder ───────────────────────────────────────────────

export interface BuildSnapshotArgs {
  capabilities: ControllerCapabilities;
  /** Raw $$ settings text (T2-110 capture); null when unavailable. */
  settingsRaw?: string | null;
  /** Concatenation of [VER:...] + [OPT:...] (T2-110); null when unavailable. */
  identityRaw?: string | null;
}

export function buildTicketCapabilitySnapshot(args: BuildSnapshotArgs): TicketCapabilitySnapshot {
  return {
    capabilitySnapshotHash: hashCapabilitiesValue(args.capabilities),
    settingsHash: args.settingsRaw == null || args.settingsRaw.trim() === ''
      ? null : fnv1a32Hex(args.settingsRaw),
    controllerIdentityHash: args.identityRaw == null || args.identityRaw.trim() === ''
      ? null : fnv1a32Hex(args.identityRaw),
    capabilitiesUsed: args.capabilities,
  };
}

// ─── mismatch detection ────────────────────────────────────

export interface CurrentMachineState {
  capabilities: ControllerCapabilities;
  settingsRaw?: string | null;
  identityRaw?: string | null;
}

/**
 * Compare a stored snapshot to current machine state. Returns the
 * FIRST mismatch found, in the order:
 *   1. controller identity (most specific — the controller itself changed)
 *   2. settings ($$ values)
 *   3. capability snapshot (full capabilities object)
 *   4. specific high-impact fields ($30 maxPower, bed dims, laser mode,
 *      execution model) — these enrich the message even when the broader
 *      hashes match (e.g. controller upgraded firmware version of an
 *      identical capability set), or when the snapshot hashes are absent.
 *
 * Returns null when fingerprints match.
 */
export function detectCapabilityMismatch(
  snapshot: TicketCapabilitySnapshot,
  current: CurrentMachineState,
): CapabilityMismatchReason | null {
  // 1. Identity change
  if (snapshot.controllerIdentityHash != null) {
    const currentIdentity = current.identityRaw == null || current.identityRaw.trim() === ''
      ? null : fnv1a32Hex(current.identityRaw);
    if (currentIdentity !== snapshot.controllerIdentityHash) {
      return {
        kind: 'controller-identity-changed',
        message: 'The controller identity (firmware version / build options) changed since this G-code was compiled. Recompile with the current controller before running.',
      };
    }
  }

  // 2. $$ settings change
  if (snapshot.settingsHash != null) {
    const currentSettings = current.settingsRaw == null || current.settingsRaw.trim() === ''
      ? null : fnv1a32Hex(current.settingsRaw);
    if (currentSettings !== snapshot.settingsHash) {
      return {
        kind: 'controller-settings-changed',
        message: 'Controller $$ settings changed since this G-code was compiled. Recompile with current settings before running.',
      };
    }
  }

  // 3. Per-field high-impact checks (run BEFORE the broader capability
  //    hash so the user gets an actionable message ("$30 changed
  //    1000→255") rather than the generic "capabilities changed").
  const cap = current.capabilities;
  const usedCap = snapshot.capabilitiesUsed;
  if (cap.laser.maxPowerValue !== usedCap.laser.maxPowerValue) {
    return {
      kind: 'max-spindle-changed',
      message: `Maximum laser power changed from ${usedCap.laser.maxPowerValue} to ${cap.laser.maxPowerValue} since compile. Recompile to use the current value.`,
      detail: { field: 'laser.maxPowerValue', before: usedCap.laser.maxPowerValue, after: cap.laser.maxPowerValue },
    };
  }
  if (cap.motion.bedWidthMm !== usedCap.motion.bedWidthMm
      || cap.motion.bedHeightMm !== usedCap.motion.bedHeightMm) {
    return {
      kind: 'bed-dimensions-changed',
      message: `Bed dimensions changed from ${usedCap.motion.bedWidthMm}×${usedCap.motion.bedHeightMm}mm to ${cap.motion.bedWidthMm}×${cap.motion.bedHeightMm}mm since compile. Recompile to verify bounds.`,
      detail: {
        field: 'motion.bed*',
        before: { w: usedCap.motion.bedWidthMm, h: usedCap.motion.bedHeightMm },
        after: { w: cap.motion.bedWidthMm, h: cap.motion.bedHeightMm },
      },
    };
  }
  if (cap.laser.powerUnit !== usedCap.laser.powerUnit
      || cap.laser.laserOffOperation !== usedCap.laser.laserOffOperation) {
    return {
      kind: 'laser-mode-changed',
      message: `Laser mode changed since compile (powerUnit or laserOffOperation differ). Recompile to use the current laser configuration.`,
    };
  }
  if (cap.output.jobExecution !== usedCap.output.jobExecution) {
    return {
      kind: 'execution-model-changed',
      message: `Controller job execution model changed since compile (${usedCap.output.jobExecution} → ${cap.output.jobExecution}). Recompile.`,
      detail: { field: 'output.jobExecution', before: usedCap.output.jobExecution, after: cap.output.jobExecution },
    };
  }

  // 4. Catch-all capability hash
  const currentCapHash = hashCapabilitiesValue(current.capabilities);
  if (currentCapHash !== snapshot.capabilitySnapshotHash) {
    return {
      kind: 'capabilities-changed',
      message: 'Controller capabilities changed since this G-code was compiled. Recompile to continue.',
    };
  }

  return null;
}

/**
 * Convenience predicate: is the ticket valid against the current
 * machine? `true` when fingerprints match.
 */
export function ticketStillValid(
  snapshot: TicketCapabilitySnapshot,
  current: CurrentMachineState,
): boolean {
  return detectCapabilityMismatch(snapshot, current) === null;
}
