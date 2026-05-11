/**
 * T1-163 (audit F-001): extracted token type + factory + type-guard
 * for the T1-116 `setStopOnError(false)` override gate.
 *
 * Pre-T1-163 the token type lived inside `GrblController.ts`. The
 * `ControllerInterface.setStopOnError` signature declared
 * `(value: boolean) => void`, so a caller wired against the interface
 * alone had no compile-time signal that the token was required —
 * `controller.setStopOnError(false)` would compile and only throw at
 * runtime. The full-code audit (docs/AUDIT-2026-05-11.md F-001)
 * flagged this.
 *
 * Post-T1-163 the type lives in this module, ControllerInterface
 * imports it, and the signature reads
 * `setStopOnError?(value: boolean, token?: UnsafeStopOnErrorOverrideToken): void`.
 * Callers wired against the interface see the token slot at compile
 * time. The runtime gate in `GrblController.setStopOnError` is
 * unchanged — it remains the load-bearing defense.
 *
 * No behavior change. The kind brand, factory, and type-guard are
 * byte-identical to the pre-extraction implementation.
 */

/**
 * Opaque token authorizing a `setStopOnError(false)` call. T1-116
 * intent preserved: continuing past GRBL `error:` lines after
 * malformed G-code is unsafe, so every override must carry an
 * explicit non-empty reason string + a mintedAt timestamp so a
 * future audit / ban-list subsystem can attribute it.
 */
export interface UnsafeStopOnErrorOverrideToken {
  readonly kind: 'unsafe-stop-on-error-override-token';
  readonly reason: string;
  readonly mintedAt: number;
}

const STOP_ON_ERROR_OVERRIDE_TOKEN_KIND = 'unsafe-stop-on-error-override-token' as const;

/**
 * Mint a fresh `UnsafeStopOnErrorOverrideToken`. Always logs a
 * console warning so an override can never happen invisibly.
 * Production paths never call this; only test harnesses or an
 * explicit diagnostics-mode call site reach this code.
 *
 * Throws on empty / whitespace-only `reason` so the audit trail
 * cannot be defeated by passing `''`.
 */
export function createStopOnErrorOverrideToken(reason: string): UnsafeStopOnErrorOverrideToken {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('createStopOnErrorOverrideToken requires a non-empty reason string.');
  }
  console.warn(
    `[GrblController] T1-116 stop-on-error override minted: "${reason}". `
    + 'Streaming may continue after GRBL error: lines until the override is cleared.',
  );
  return Object.freeze({
    kind: STOP_ON_ERROR_OVERRIDE_TOKEN_KIND,
    reason,
    mintedAt: Date.now(),
  });
}

/**
 * Type-guard. Used by `GrblController.setStopOnError` to validate
 * a token at runtime — the interface-level type check is necessary
 * but not sufficient (an attacker handing in `{kind:'...', reason:''}`
 * could forge the structural shape; this guard checks both fields
 * are present + non-empty).
 */
export function isUnsafeStopOnErrorOverrideToken(
  value: unknown,
): value is UnsafeStopOnErrorOverrideToken {
  if (value == null || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; reason?: unknown };
  return (
    v.kind === STOP_ON_ERROR_OVERRIDE_TOKEN_KIND
    && typeof v.reason === 'string'
    && v.reason.length > 0
  );
}
