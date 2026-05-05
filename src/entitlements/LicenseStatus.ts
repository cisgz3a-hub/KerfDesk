/**
 * T2-93: license status as a first-class discriminated union, refining
 * T1-80's flat-string `status` field. Pre-T2-93 callers had to read
 * the flat status plus several sibling fields (`lastVerifiedAt`,
 * `graceUntil`, `lastError`) to know what to render. T2-93 packages
 * each status kind with the metadata that's relevant to it, so a
 * `switch (status.kind)` covers every UI case exhaustively and the
 * compiler catches missing branches.
 *
 * Layered alongside T1-80, not replacing it. `EntitlementState.status`
 * (flat string) stays for backward-compat with existing readers; the
 * new `EntitlementState.statusDetail` (this discriminated union)
 * carries the richer shape. A future T2-93-followup migration drops
 * the legacy field once all UI consumers move over.
 */

export type LicenseStatusDetail =
  | { kind: 'free' }
  | { kind: 'verified'; lastVerifiedAt: number; expiresAt?: number }
  | { kind: 'offline_grace'; lastVerifiedAt: number; graceUntil: number }
  | { kind: 'expired'; expiredAt: number }
  | { kind: 'verification_failed'; attemptedAt: number; lastError: string }
  | {
      kind: 'revoked';
      revokedAt: number;
      reason: 'refunded' | 'chargebacked' | 'disputed' | 'manual';
    }
  | { kind: 'developer' }
  | { kind: 'tester'; testerSlug: string };

export type LicenseStatusKind = LicenseStatusDetail['kind'];

/**
 * Predicate: does this status grant Pro access? Single source of truth
 * for the whole "is this user paid right now?" question — replaces
 * scattered `tier === 'paid' || tier === 'developer' || ...` checks.
 *
 * Verified, offline_grace, developer, and tester all grant Pro.
 * Revoked / expired / verification_failed / free do not.
 */
export function statusAllowsPro(status: LicenseStatusDetail): boolean {
  switch (status.kind) {
    case 'verified':
    case 'offline_grace':
    case 'developer':
    case 'tester':
      return true;
    case 'free':
    case 'expired':
    case 'verification_failed':
    case 'revoked':
      return false;
  }
}

/**
 * Render-ready summary for each status. Tone drives badge color
 * (`ok` = green, `warn` = yellow, `error` = red, `neutral` = gray).
 * Title is a 2-3 word headline; message is the explanation. Actions
 * are zero or more user-facing buttons.
 */
export interface StatusUserSummary {
  tone: 'ok' | 'warn' | 'error' | 'neutral';
  title: string;
  message: string;
  actions: Array<'retry' | 'contact-support' | 'renew' | 'enter-license'>;
}

export function statusUserMessage(status: LicenseStatusDetail): StatusUserSummary {
  switch (status.kind) {
    case 'free':
      return {
        tone: 'neutral',
        title: 'Free user',
        message: 'Pro features are not enabled. Enter a license key to unlock.',
        actions: ['enter-license'],
      };
    case 'verified':
      return {
        tone: 'ok',
        title: 'Pro verified',
        message:
          status.expiresAt != null
            ? `Verified until ${new Date(status.expiresAt).toLocaleDateString()}.`
            : 'License verified.',
        actions: [],
      };
    case 'offline_grace':
      return {
        tone: 'warn',
        title: 'Offline grace',
        message:
          `Pro active until ${new Date(status.graceUntil).toLocaleDateString()} ` +
          `(connect to verify).`,
        actions: [],
      };
    case 'expired':
      return {
        tone: 'error',
        title: 'Subscription expired',
        message: `Renew to restore Pro features.`,
        actions: ['renew'],
      };
    case 'verification_failed':
      return {
        tone: 'error',
        title: 'Could not verify license',
        message: status.lastError || 'Unknown verification error.',
        actions: ['retry', 'contact-support'],
      };
    case 'revoked':
      return {
        tone: 'error',
        title: 'License revoked',
        message: `License has been ${status.reason}. Contact support if this is a mistake.`,
        actions: ['contact-support'],
      };
    case 'developer':
      return {
        tone: 'ok',
        title: 'Developer build',
        message: 'All Pro features unlocked for development.',
        actions: [],
      };
    case 'tester':
      return {
        tone: 'ok',
        title: 'Tester key',
        message: `Tester key issued to ${status.testerSlug}.`,
        actions: [],
      };
  }
}

/**
 * Bridge from the T1-80 flat status string + sibling fields to the
 * T2-93 discriminated union. EntitlementService uses this when it
 * sets state — the flat status field stays for backward compat, the
 * detail union becomes the canonical source.
 */
export function buildStatusDetail(args: {
  status:
    | 'free'
    | 'verified'
    | 'offline_grace'
    | 'verification_failed'
    | 'revoked'
    | 'developer'
    | 'tester';
  lastVerifiedAt?: number;
  graceUntil?: number;
  lastError?: string;
  testerSlug?: string;
  revokedReason?: 'refunded' | 'chargebacked' | 'disputed' | 'manual';
  now?: number;
}): LicenseStatusDetail {
  const now = args.now ?? Date.now();
  switch (args.status) {
    case 'free':
      return { kind: 'free' };
    case 'verified':
      return {
        kind: 'verified',
        lastVerifiedAt: args.lastVerifiedAt ?? now,
      };
    case 'offline_grace':
      return {
        kind: 'offline_grace',
        lastVerifiedAt: args.lastVerifiedAt ?? now,
        graceUntil: args.graceUntil ?? now,
      };
    case 'verification_failed':
      return {
        kind: 'verification_failed',
        attemptedAt: now,
        lastError: args.lastError ?? 'Verification failed.',
      };
    case 'revoked':
      return {
        kind: 'revoked',
        revokedAt: now,
        reason: args.revokedReason ?? 'manual',
      };
    case 'developer':
      return { kind: 'developer' };
    case 'tester':
      return {
        kind: 'tester',
        testerSlug: args.testerSlug ?? 'unknown',
      };
  }
}
