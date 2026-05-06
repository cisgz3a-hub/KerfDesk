/**
 * T2-94: clock-tamper detection for offline grace. Pre-T2-94 the
 * offline-grace check at `EntitlementService.ts:255 + :304` used
 * `Date.now() - cached.validatedAt` — a user could roll back the
 * system clock to extend grace indefinitely. Audit 5A Critical 7 +
 * Required Priority 7.
 *
 * T2-94 ships the detector + the server-time-grace primitive. The
 * sophisticated server-time path depends on T2-89 (server-side
 * entitlement service) + T2-90 (signed local token); this module
 * declares the detection logic so the eventual signed-token check
 * can drop in unchanged.
 *
 * Three detection signals:
 *   1. **Backwards** — wall clock observed earlier than the most-
 *      recent persisted observation. Indicates rollback.
 *   2. **Forward jump** — wall clock observed > 1 year ahead of
 *      the previous observation. Indicates "set far future" attack.
 *   3. **Server-time grace breach** — local clock past the server-
 *      stamped `exp` field. Honours the server's word over the
 *      local clock's; can't be extended by clock rollback because
 *      the server's signature pins the expiry.
 */

/**
 * Persisted clock state. Stored in the SAME signed envelope as the
 * entitlement token (T2-90) once that ships, so editing the
 * persisted state requires forging the signature too.
 */
export interface ClockState {
  /** Monotonic counter — increments on every meaningful event. */
  monotonicCounter: number;
  /** Last `Date.now()` observed at update time. */
  lastObservedWallClock: number;
  /** Server-reported time at last successful online verify (T2-89). */
  serverTimeAtLastVerify: number;
  /** Grace expiry stamped by the server (server time units, ms since epoch). */
  graceUntilServerTime: number;
}

/**
 * What the detector found. Returned by `detectClockTamper` so the
 * caller can route based on the kind ("rolled back" gets a specific
 * message different from "jumped forward").
 */
export type ClockTamperKind =
  | 'rolled-back'
  | 'jumped-forward'
  | 'server-time-grace-expired'
  | 'monotonic-regression';

export interface ClockTamperReason {
  kind: ClockTamperKind;
  message: string;
  detail?: { observed?: number; previous?: number; threshold?: number };
}

/** One year in ms — the forward-jump threshold. */
export const FORWARD_JUMP_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000;

export function emptyClockState(now: number, serverTimeAtLastVerify = now): ClockState {
  return {
    monotonicCounter: 0,
    lastObservedWallClock: now,
    serverTimeAtLastVerify,
    graceUntilServerTime: 0,
  };
}

/**
 * Pure detector. Runs on every meaningful event (boot, license
 * verify, periodic poll). Returns null when no tamper is detected;
 * otherwise returns the FIRST tamper kind found, in priority order:
 *   1. monotonic regression (counter went down — internal corruption)
 *   2. wall-clock rollback
 *   3. forward jump > 1 year
 *   4. server-time grace expired
 *
 * The caller persists `ClockState` AFTER consulting this, so the
 * detector sees the previous state vs `currentNow`.
 */
export function detectClockTamper(args: {
  state: ClockState;
  currentNow: number;
  /**
   * Optional fresh counter the caller emits — used for monotonic-
   * regression detection. When omitted, the monotonic check is
   * skipped (it's not load-bearing for first-class tamper detection).
   */
  currentCounter?: number;
  /**
   * Optional server-time-grace check. When the caller has a server-
   * stamped exp, pass it via `state.graceUntilServerTime`; this
   * function compares `currentNow` against it.
   */
}): ClockTamperReason | null {
  const { state, currentNow, currentCounter } = args;

  if (currentCounter !== undefined && currentCounter < state.monotonicCounter) {
    return {
      kind: 'monotonic-regression',
      message: 'Internal counter regressed — persisted clock state may be corrupted.',
      detail: { observed: currentCounter, previous: state.monotonicCounter },
    };
  }

  if (currentNow < state.lastObservedWallClock) {
    return {
      kind: 'rolled-back',
      message: 'System clock has rolled back since the last observation. License grace cannot be extended by clock manipulation.',
      detail: { observed: currentNow, previous: state.lastObservedWallClock },
    };
  }

  if (currentNow - state.lastObservedWallClock > FORWARD_JUMP_THRESHOLD_MS) {
    return {
      kind: 'jumped-forward',
      message: 'System clock jumped forward by more than a year. License verification is required before continuing.',
      detail: {
        observed: currentNow,
        previous: state.lastObservedWallClock,
        threshold: FORWARD_JUMP_THRESHOLD_MS,
      },
    };
  }

  if (state.graceUntilServerTime > 0 && currentNow > state.graceUntilServerTime) {
    return {
      kind: 'server-time-grace-expired',
      message: 'License grace period (server-stamped) has expired. Online verification required.',
      detail: {
        observed: currentNow,
        previous: state.graceUntilServerTime,
      },
    };
  }

  return null;
}

/**
 * Update the state with a new observation. Bumps monotonic counter
 * and records the wall clock. Caller persists the result.
 */
export function updateClockState(args: {
  state: ClockState;
  currentNow: number;
  serverTime?: number;
  graceUntilServerTime?: number;
}): ClockState {
  return {
    monotonicCounter: args.state.monotonicCounter + 1,
    lastObservedWallClock: args.currentNow,
    serverTimeAtLastVerify: args.serverTime ?? args.state.serverTimeAtLastVerify,
    graceUntilServerTime: args.graceUntilServerTime ?? args.state.graceUntilServerTime,
  };
}

/**
 * Server-time grace primitive. The eventual T2-89 token's `exp`
 * field is the authoritative grace deadline; this function just
 * compares it to the current local clock. The KEY property: the
 * client cannot extend the deadline by rolling back the local clock
 * because `exp` is server-signed (T2-90).
 *
 * Returns 'expired' when current > exp; 'in-grace' when current
 * is within [now, exp]; 'not-yet' when current < iat (clock far in
 * the past — also a tamper signal).
 */
export type GraceCheckResult = 'in-grace' | 'expired' | 'not-yet';

export function checkServerTimeGrace(args: {
  iat: number;       // server "issued at" — ms since epoch
  exp: number;       // server "expires at" — ms since epoch
  currentNow: number;
}): GraceCheckResult {
  if (args.currentNow < args.iat) return 'not-yet';
  if (args.currentNow > args.exp) return 'expired';
  return 'in-grace';
}

/**
 * User-facing message for a tamper reason. The auth UI uses this
 * to render "Clock tampering suspected — verify online to continue."
 */
export function clockTamperUserMessage(reason: ClockTamperReason): string {
  switch (reason.kind) {
    case 'rolled-back':
      return 'Your system clock appears to have rolled back. License grace cannot be extended by clock manipulation. Please verify your license online to continue.';
    case 'jumped-forward':
      return 'Your system clock has jumped far forward. License verification is required before continuing offline.';
    case 'server-time-grace-expired':
      return 'Your license grace period has expired. Please verify online to continue using Pro features.';
    case 'monotonic-regression':
      return 'License state appears corrupted. Please verify your license online.';
  }
}
