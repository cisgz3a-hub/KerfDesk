/**
 * T2-38: `CapabilityValue<T>` model with source/confidence/verifiedAt.
 * Pre-T2-38 a value of `1000` in compile output could mean any of:
 *   - verified `$30=1000` (live-read this session)
 *   - profile says 1000 (manually set, possibly correct)
 *   - fallback default 1000 (no profile, no controller)
 *   - stale profile from a different machine
 *
 * The codebase had no way to express the difference, so preflight
 * couldn't say "this value is verified" vs "this is a guess."
 * Audit 3C Finding 3.2 + Required Priority 1.
 *
 * T2-38 ships the wrapping type + the resolution helpers + the
 * preflight-confidence gate. Refactoring `ControllerCapabilities`
 * (T2-25, shipped in `73d83bc`) to wrap each numeric/boolean field
 * in `CapabilityValue<T>` is filed as T2-38-followup since it
 * touches every consumer of the bare values.
 */

/** Where the value came from. */
export type CapabilitySource = 'firmware' | 'profile' | 'default' | 'unknown';

/**
 * How much the system trusts the value. `verified` is the only
 * confidence preflight should accept for safety-critical decisions
 * (T1-53 — using firmware-source for compile).
 */
export type CapabilityConfidence = 'verified' | 'manual' | 'fallback' | 'unknown';

export interface CapabilityValue<T> {
  /** The value itself. Null when no source produced one. */
  value: T | null;
  source: CapabilitySource;
  confidence: CapabilityConfidence;
  /** Unix ms when the value was last verified from firmware. */
  verifiedAt?: number;
}

// ─── builders ──────────────────────────────────────────────

export function verifiedFromFirmware<T>(value: T, now: number): CapabilityValue<T> {
  return { value, source: 'firmware', confidence: 'verified', verifiedAt: now };
}

export function manualFromProfile<T>(value: T): CapabilityValue<T> {
  return { value, source: 'profile', confidence: 'manual' };
}

export function fallbackDefault<T>(value: T): CapabilityValue<T> {
  return { value, source: 'default', confidence: 'fallback' };
}

export function unknownValue<T>(): CapabilityValue<T> {
  return { value: null, source: 'unknown', confidence: 'unknown' };
}

/**
 * Resolve a single value from the priority chain
 *   firmware > profile > default
 * Skipping null/undefined sources — first concrete value wins.
 *
 * `now` is the unix-ms clock used to stamp `verifiedAt` when the
 * firmware path fires. Tests inject a fixed value.
 */
export interface ResolveArgs<T> {
  firmware?: T | null | undefined;
  profile?: T | null | undefined;
  defaultValue?: T;
  now: number;
}

export function resolveCapabilityValue<T>(args: ResolveArgs<T>): CapabilityValue<T> {
  if (args.firmware !== null && args.firmware !== undefined) {
    return verifiedFromFirmware(args.firmware, args.now);
  }
  if (args.profile !== null && args.profile !== undefined) {
    return manualFromProfile(args.profile);
  }
  if (args.defaultValue !== undefined) {
    return fallbackDefault(args.defaultValue);
  }
  return unknownValue<T>();
}

// ─── preflight gate ────────────────────────────────────────

export type ConfidenceLevel = 'verified' | 'manual' | 'fallback' | 'unknown';

const RANK: Record<CapabilityConfidence, number> = {
  verified: 3,
  manual: 2,
  fallback: 1,
  unknown: 0,
};

/**
 * True when `actual` is at least as confident as `required`.
 * Preflight gates compile/start with `requireConfidence(value, 'verified')`
 * for safety-critical fields and `'manual'` for non-safety-critical.
 */
export function meetsConfidence<T>(
  v: CapabilityValue<T>,
  required: ConfidenceLevel,
): boolean {
  return RANK[v.confidence] >= RANK[required];
}

/** Convenience: extract the value or null if missing. */
export function valueOrNull<T>(v: CapabilityValue<T>): T | null {
  return v.value;
}

/** Convenience: extract the value, throwing when null. Useful at compile boundary. */
export function valueOrThrow<T>(v: CapabilityValue<T>, fieldName: string): T {
  if (v.value == null) {
    throw new Error(`CapabilityValue for ${fieldName} is null (source=${v.source}, confidence=${v.confidence})`);
  }
  return v.value;
}

/**
 * User-facing confidence indicator. Used by the value chips T3-58 will
 * surface (e.g. `$30 = 1000 ✓ verified` vs `bedWidth = 400 ⚠ manual`).
 */
export function confidenceLabel(c: CapabilityConfidence): string {
  switch (c) {
    case 'verified': return 'Verified';
    case 'manual': return 'Manual';
    case 'fallback': return 'Default';
    case 'unknown': return 'Unknown';
  }
}

/**
 * Audit-trail summary for embedding in JobLog / support bundle.
 * Stable string representation including verifiedAt timestamp.
 */
export function describeCapabilityValue<T>(v: CapabilityValue<T>): string {
  if (v.value === null) return `<unknown> (${v.source}/${v.confidence})`;
  const ts = v.verifiedAt != null ? ` @${new Date(v.verifiedAt).toISOString()}` : '';
  return `${String(v.value)} (${v.source}/${v.confidence}${ts})`;
}
