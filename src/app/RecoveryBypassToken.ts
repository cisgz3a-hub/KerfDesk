/**
 * T1-219 (v30 audit #4): token type + factory + type-guard for the
 * `MachineService.acknowledgeRecoveryComplete` bypass + the
 * `setRecoveryState` direct-clear gate.
 *
 * Pre-T1-219 both methods were unrestricted public APIs that
 * could clear an active recovery (alarm, E-stop, disconnect-
 * during-job, frame-failed, compile-failed) without enforcing
 * the per-step checklist. The audit's concrete worry:
 *
 *   "A UI path, debug path, or future feature clears recovery
 *    after alarm/E-stop/disconnect without rehome/reframe/
 *    inspection actually completed. A subsequent job starts
 *    from unknown position or damaged material."
 *
 * Post-T1-219 every bypass path must mint and present this
 * token. Token requires a non-empty reason string (audit trail
 * cannot be defeated by `''`) and the factory always logs a
 * console warning so a bypass cannot happen invisibly. Tokens
 * are not currently single-use — the runtime gate only validates
 * shape — but the audit doc + reason string keep every bypass
 * attributable.
 *
 * Mirrors `src/controllers/grbl/StopOnErrorOverrideToken.ts`
 * (T1-163) byte-for-byte in shape so future audit-grade override
 * gates keep a consistent pattern.
 */

/**
 * Opaque token authorizing a `setRecoveryState({status:'none'})`
 * direct clear OR an `acknowledgeRecoveryComplete()` bypass of
 * the per-step recovery checklist.
 */
export interface UnsafeRecoveryBypassToken {
  readonly kind: 'unsafe-recovery-bypass-token';
  readonly reason: string;
  readonly mintedAt: number;
}

const RECOVERY_BYPASS_TOKEN_KIND = 'unsafe-recovery-bypass-token' as const;

/**
 * Mint a fresh `UnsafeRecoveryBypassToken`. Always logs a console
 * warning so a bypass can never happen invisibly. Production
 * paths should NOT call this — the legitimate clear path runs
 * through `MachineService.applyRecoveryAck(step)`, which advances
 * the per-step checklist and auto-transitions to `'none'` when
 * every required step is done. The bypass token is only for
 * explicit user-initiated override flows (e.g. a "Reset
 * recovery" diagnostic button) and for test harnesses.
 *
 * Throws on empty / whitespace-only `reason` so the audit trail
 * cannot be defeated by passing `''`.
 */
export function createUnsafeRecoveryBypassToken(reason: string): UnsafeRecoveryBypassToken {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('createUnsafeRecoveryBypassToken requires a non-empty reason string.');
  }
  console.warn(
    `[MachineService] T1-219 recovery-bypass token minted: "${reason}". `
    + 'The per-step recovery checklist is being bypassed. Verify the '
    + 'physical machine state (homed, framed, inspected) before starting '
    + 'the next job.',
  );
  return Object.freeze({
    kind: RECOVERY_BYPASS_TOKEN_KIND,
    reason,
    mintedAt: Date.now(),
  });
}

/**
 * Type-guard. Used by `MachineService.setRecoveryState` and
 * `MachineService.acknowledgeRecoveryComplete` to validate a
 * token at runtime — the interface-level type check is necessary
 * but not sufficient (an attacker handing in `{kind:'...',
 * reason:''}` could forge the structural shape; this guard checks
 * both fields are present + non-empty).
 */
export function isUnsafeRecoveryBypassToken(
  value: unknown,
): value is UnsafeRecoveryBypassToken {
  if (value == null || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; reason?: unknown };
  return (
    v.kind === RECOVERY_BYPASS_TOKEN_KIND
    && typeof v.reason === 'string'
    && v.reason.length > 0
  );
}
