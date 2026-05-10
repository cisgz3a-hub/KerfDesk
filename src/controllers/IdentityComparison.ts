/**
 * T3-51: compare a saved `IdentitySnapshot` from a profile against the
 * live `DeviceIdentity` returned by `GrblController.getDeviceIdentity()`
 * (T3-50). The comparator categorizes mismatches into three severities:
 *
 *   - `match`: every comparable field agrees.
 *   - `prompt`: differences that are common-but-suspicious (firmware
 *     version drift after a flash, build options shifting). UI should
 *     ask the user to confirm before continuing.
 *   - `block`: structural mismatches (bed dimensions, max spindle)
 *     that almost certainly mean the user picked the wrong port.
 *
 * Audit 3B section 10.4 + Required P1 fix called out the failure mode:
 * a user with two Falcons sees `requestPort()` and accidentally picks
 * the wrong one, and the wrong-machine connection runs with the wrong
 * profile's settings (silent bed-size mismatch, scanning-offset
 * mismatch, max-spindle mismatch). Comparing the live identity against
 * the persisted snapshot catches this.
 *
 * **This module is purely additive type plumbing.** Persisting an
 * `IdentitySnapshot` to the active profile (via T3-46's split-profile
 * schema) and threading the comparator into the live connect flow
 * (via T2-32 ConnectionManager) are deferred to follow-up T3-51 slices,
 * gated on a non-GRBL profile actually using the conflict detection.
 * Same foundation-first pattern T3-43 / T3-44 / T3-46 / T3-50 used.
 *
 * Pairs with T3-50 (`DeviceIdentity` capture).
 */

import type { DeviceIdentity } from './ControllerInterface';

/**
 * Persisted form of `DeviceIdentity` carried in the profile alongside
 * a capture timestamp. The timestamp is informational only — comparison
 * does not depend on it, but UI surfaces it as "last seen at" context.
 */
export interface IdentitySnapshot {
  readonly firmwareVersion: string | null;
  readonly buildOptions: string | null;
  readonly maxSpindle: number | null;
  readonly bedWidthMm: number | null;
  readonly bedHeightMm: number | null;
  readonly homingDirection: number | null;
  readonly homingEnabled: boolean | null;
  readonly laserMode: boolean | null;
  /** ms since epoch when the snapshot was captured. */
  readonly capturedAt: number;
}

export type IdentityChangeKind =
  | 'firmware-version-changed'
  | 'build-options-changed'
  | 'bed-width-changed'
  | 'bed-height-changed'
  | 'max-spindle-changed'
  | 'homing-enabled-changed'
  | 'laser-mode-changed';

export interface IdentityChange {
  readonly kind: IdentityChangeKind;
  /** Stringified for UI display; numeric fields are rounded to integers. */
  readonly previous: string;
  readonly current: string;
  readonly path: string;
}

export type IdentityVerdict = 'match' | 'prompt' | 'block';

export interface IdentityComparison {
  readonly verdict: IdentityVerdict;
  readonly changes: readonly IdentityChange[];
  /** Stringified human-readable summary for UI / log. */
  readonly summary: string;
}

/**
 * Tolerance for "essentially equal" numeric fields. Bed dimensions are
 * usually integer mm, but $30 max-spindle can drift by a unit when
 * firmware reports floats; one-unit slack avoids spurious blocks.
 */
const EPSILON = 1e-3;

function eqNumber(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= EPSILON;
}

function fmtNumber(v: number | null): string {
  if (v == null) return 'unknown';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtString(v: string | null): string {
  return v ?? 'unknown';
}

function fmtBool(v: boolean | null): string {
  return v == null ? 'unknown' : v ? 'on' : 'off';
}

/**
 * Compare a saved snapshot to a live identity. Field semantics:
 *
 *   - **Bed width / height** (block): cannot legitimately change for
 *     the same physical machine. A mismatch almost always means the
 *     user picked the wrong port.
 *   - **Max spindle** (block): GRBL `$30` is a per-machine calibration
 *     constant. A difference > 1% is structural; treat as block.
 *   - **Firmware version** (prompt): legitimate change after firmware
 *     flash. UI asks user to confirm.
 *   - **Build options** (prompt): legitimate change with firmware
 *     updates. UI asks user to confirm.
 *   - **Homing enabled / laser mode** (prompt): user may have changed
 *     `$22` / `$32` deliberately. Surface but don't block.
 *
 * `null` fields on either side indicate "not yet observed" — never a
 * block. Live identity that is partially populated (e.g. `[VER:]`
 * arrived but `$$` hasn't yet) returns `match` for the missing fields
 * rather than treating them as changes.
 */
export function compareIdentities(
  stored: IdentitySnapshot,
  live: DeviceIdentity,
): IdentityComparison {
  const changes: IdentityChange[] = [];

  if (
    stored.firmwareVersion !== null
    && live.firmwareVersion !== null
    && stored.firmwareVersion !== live.firmwareVersion
  ) {
    changes.push({
      kind: 'firmware-version-changed',
      previous: stored.firmwareVersion,
      current: live.firmwareVersion,
      path: 'firmwareVersion',
    });
  }

  if (
    stored.buildOptions !== null
    && live.buildOptions !== null
    && stored.buildOptions !== live.buildOptions
  ) {
    changes.push({
      kind: 'build-options-changed',
      previous: stored.buildOptions,
      current: live.buildOptions,
      path: 'buildOptions',
    });
  }

  if (
    stored.bedWidthMm !== null
    && live.bedWidthMm !== null
    && !eqNumber(stored.bedWidthMm, live.bedWidthMm)
  ) {
    changes.push({
      kind: 'bed-width-changed',
      previous: fmtNumber(stored.bedWidthMm),
      current: fmtNumber(live.bedWidthMm),
      path: 'bedWidthMm',
    });
  }

  if (
    stored.bedHeightMm !== null
    && live.bedHeightMm !== null
    && !eqNumber(stored.bedHeightMm, live.bedHeightMm)
  ) {
    changes.push({
      kind: 'bed-height-changed',
      previous: fmtNumber(stored.bedHeightMm),
      current: fmtNumber(live.bedHeightMm),
      path: 'bedHeightMm',
    });
  }

  if (
    stored.maxSpindle !== null
    && live.maxSpindle !== null
    && !eqNumber(stored.maxSpindle, live.maxSpindle)
  ) {
    // Allow 1% drift for firmware float rounding; anything larger is
    // a real calibration change worth blocking on.
    const ratio = Math.abs(stored.maxSpindle - live.maxSpindle) / Math.max(1, stored.maxSpindle);
    if (ratio > 0.01) {
      changes.push({
        kind: 'max-spindle-changed',
        previous: fmtNumber(stored.maxSpindle),
        current: fmtNumber(live.maxSpindle),
        path: 'maxSpindle',
      });
    }
  }

  if (
    stored.homingEnabled !== null
    && live.homingEnabled !== null
    && stored.homingEnabled !== live.homingEnabled
  ) {
    changes.push({
      kind: 'homing-enabled-changed',
      previous: fmtBool(stored.homingEnabled),
      current: fmtBool(live.homingEnabled),
      path: 'homingEnabled',
    });
  }

  if (
    stored.laserMode !== null
    && live.laserMode !== null
    && stored.laserMode !== live.laserMode
  ) {
    changes.push({
      kind: 'laser-mode-changed',
      previous: fmtBool(stored.laserMode),
      current: fmtBool(live.laserMode),
      path: 'laserMode',
    });
  }

  const verdict = pickVerdict(changes);
  return {
    verdict,
    changes,
    summary: summarizeChanges(changes, verdict),
  };
}

function pickVerdict(changes: readonly IdentityChange[]): IdentityVerdict {
  if (changes.length === 0) return 'match';
  for (const c of changes) {
    if (c.kind === 'bed-width-changed' || c.kind === 'bed-height-changed' || c.kind === 'max-spindle-changed') {
      return 'block';
    }
  }
  return 'prompt';
}

function summarizeChanges(changes: readonly IdentityChange[], verdict: IdentityVerdict): string {
  if (changes.length === 0) return 'Connected device matches the last-known identity.';
  const lines = changes.map((c) => {
    const human = humanReadableChange(c);
    return `  • ${human}: ${c.previous} → ${c.current}`;
  });
  const headline = verdict === 'block'
    ? 'Connected device looks like a different machine — review before continuing:'
    : 'Connected device differs from the last-known identity:';
  return [headline, ...lines].join('\n');
}

function humanReadableChange(change: IdentityChange): string {
  switch (change.kind) {
    case 'firmware-version-changed': return 'firmware version';
    case 'build-options-changed': return 'GRBL build options ($I)';
    case 'bed-width-changed': return 'bed width';
    case 'bed-height-changed': return 'bed height';
    case 'max-spindle-changed': return '$30 max spindle';
    case 'homing-enabled-changed': return '$22 homing enabled';
    case 'laser-mode-changed': return '$32 laser mode';
  }
}

/**
 * Build a fresh `IdentitySnapshot` from a live `DeviceIdentity` plus
 * a capture timestamp. Use after a successful first-connect (when
 * the profile has no prior snapshot) or when the user explicitly
 * accepts a `prompt`-verdict mismatch.
 */
export function makeIdentitySnapshot(
  identity: DeviceIdentity,
  capturedAt: number,
): IdentitySnapshot {
  return {
    firmwareVersion: identity.firmwareVersion,
    buildOptions: identity.buildOptions,
    maxSpindle: identity.maxSpindle,
    bedWidthMm: identity.bedWidthMm,
    bedHeightMm: identity.bedHeightMm,
    homingDirection: identity.homingDirection,
    homingEnabled: identity.homingEnabled,
    laserMode: identity.laserMode,
    capturedAt,
  };
}

// Helper exposed for predicates / UI gates.
export function isMatch(comparison: IdentityComparison): boolean {
  return comparison.verdict === 'match';
}

export function isBlock(comparison: IdentityComparison): boolean {
  return comparison.verdict === 'block';
}

export function isPrompt(comparison: IdentityComparison): boolean {
  return comparison.verdict === 'prompt';
}

// Re-export the formatter so test code can pin the formatting contract.
export const _internal = { fmtNumber, fmtBool, fmtString };
