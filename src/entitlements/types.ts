export const PRO_FEATURES = [
  // 'box_generator' moved to free: finger-joint box generation is
  // beginner-friendly and belongs in easy mode without a pro gate.
  'nesting',
  'variable_text',
   'material_test',
  'cross_hatch',
  // T1-88: 'job_replay' removed. Capture is a diagnostic tool for support
  // and is now always-on (free + Pro). When a viewer/export UI is built,
  // it can add its own Pro gate (e.g. 'job_replay_viewer') at that time.
  'power_scale',
  'cut_start_point',
  'overcut',
  'lead_in',
  'tabs',
  'text_to_path',
  'boolean_ops',
  'kerf_wizard',
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

export type EntitlementTier = 'developer' | 'tester_permanent' | 'paid' | 'trial' | 'free';

/**
 * T1-80: license validation status, surfaced to the UI so the user can tell
 * "I'm a free user" from "we couldn't verify your license — retry?". Pre-T1-80
 * a transient network error during validation deleted the stored license and
 * silently downgraded to free with no message — paid users opening the app
 * mid-Gumroad-outage saw "Free" and assumed they'd been revoked.
 *
 * - `free` — no license on file, or explicit deactivate.
 * - `verified` — Gumroad confirmed license is valid (paid tier).
 * - `offline_grace` — network failed but cache is still valid; Pro stays
 *   active until `graceUntil`.
 * - `verification_failed` — couldn't verify, cache expired beyond grace;
 *   Pro disabled but the license code is preserved so the user can retry
 *   without re-entering it.
 * - `revoked` — Gumroad confirmed refunded / chargebacked / disputed; Pro
 *   disabled and the code is preserved for visibility (UI can prompt
 *   "contact support").
 * - `developer` / `tester` — internal builds.
 */
export type LicenseStatus =
  | 'free'
  | 'verified'
  | 'offline_grace'
  | 'verification_failed'
  | 'revoked'
  | 'developer'
  | 'tester';

export interface EntitlementState {
  tier: EntitlementTier;
  hasPro: boolean;
  /** T1-80: explicit validation status. Optional only because legacy callsites that
   *  hand-build `EntitlementState` literals haven't been updated; service code always
   *  populates it. UI components should treat undefined as 'free'. */
  status?: LicenseStatus;
  label?: string;
  code?: string;
  /** T1-80: epoch ms of last successful Gumroad verification. */
  lastVerifiedAt?: number;
  /** T1-80: epoch ms after which `offline_grace` expires and falls back to verification_failed. */
  graceUntil?: number;
  /** T1-80: short message attached when status === 'verification_failed'. */
  lastError?: string;
  daysLeft?: number;
  expired?: boolean;
}

/** Persisted Gumroad-side cache shape (localStorage JSON). */
export interface StoredLicenseCacheEntry {
  code: string;
  name: string;
  validatedAt: number;
  valid: boolean;
}
