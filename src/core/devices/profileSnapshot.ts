/**
 * T2-71: device-profile snapshot diff + load-time mismatch detection.
 *
 * Pre-T2-71 a saved project stored `deviceProfileId` only. Edits to
 * the referenced profile after save silently changed the project's
 * compile output on next load — for a CAM application this is a
 * reproducibility failure (audit 4D Critical 3). T2-71 saves a
 * snapshot of the profile at write time; this helper compares the
 * snapshot to the current profile on load and reports the kind of
 * mismatch so the UI can offer the user a choice.
 */

import type { DeviceProfile } from './DeviceProfile';
import type { Scene } from '../scene/Scene';

export type ProfileSnapshotResult =
  | { kind: 'no-snapshot' }                                                  // legacy project
  | { kind: 'no-current-profile' }                                           // ID null
  | { kind: 'profile-deleted'; snapshot: DeviceProfile }                     // ID set but profile missing
  | { kind: 'match'; snapshot: DeviceProfile; current: DeviceProfile }       // identical
  | { kind: 'mismatch'; snapshot: DeviceProfile; current: DeviceProfile; changed: ProfileChange[] };

export interface ProfileChange {
  field: string;
  saved: unknown;
  current: unknown;
}

/**
 * Field-by-field comparison. Only the fields below are tracked —
 * adding a new safety-relevant field to DeviceProfile means adding
 * it here too. The set is intentional: it's the fields whose change
 * meaningfully alters compile output. Cosmetic fields (name, id,
 * timestamps, last-used metadata) are excluded.
 */
const TRACKED_FIELDS: Array<keyof DeviceProfile> = [
  'bedWidth',
  'bedHeight',
  'maxSpindle',
  'maxFeedRate',
  'originCorner',
  'baudRate',
  'machineType',
  'brand',
  'model',
  'maxAccelMmPerS2',
  'minPowerRatioAccel',
  'accelAwarePower',
  'allowsNegativeWorkspace',
  'allowUnverifiedWcsStart',
  'returnToOrigin',
  'startGcode',
  'endGcode',
  'gcodeHeaderTemplate',
  'gcodeFooterTemplate',
  'autoFocusCommand',
  'autoFocusTimeoutMs',
  'watts',
  'stopOnError',
  'maxRateX',
  'maxRateY',
  'maxAccelX',
  'maxAccelY',
];

/**
 * Returns the list of tracked fields where `current` differs from
 * `saved`. Strict equality only — for objects/arrays, JSON.stringify
 * round-trip is the comparison key.
 */
export function diffProfiles(
  saved: DeviceProfile,
  current: DeviceProfile,
): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const a = saved[field];
    const b = current[field];
    if (a === b) continue;
    // Object/array comparison via JSON. Sufficient for the
    // currently-tracked fields which are scalars or small JSON-stable
    // objects (templates).
    if (typeof a === 'object' && typeof b === 'object' && a != null && b != null) {
      try {
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
      } catch {
        /* fall through and report as changed */
      }
    }
    changes.push({ field: String(field), saved: a, current: b });
  }
  return changes;
}

/**
 * Classify the relationship between a scene's saved profile snapshot
 * and the current profile of the same id. Caller-supplied
 * `getProfileById` lets tests inject a known profile library without
 * depending on `DeviceProfile.ts`'s global storage.
 */
export function checkProfileSnapshot(
  scene: Scene,
  getProfileById: (id: string) => DeviceProfile | null,
): ProfileSnapshotResult {
  const snapshot = scene.metadata.deviceProfileSnapshot;
  if (!snapshot) return { kind: 'no-snapshot' };
  const currentId = scene.metadata.deviceProfileId;
  if (!currentId) return { kind: 'no-current-profile' };
  const current = getProfileById(currentId);
  if (!current) return { kind: 'profile-deleted', snapshot };
  const changed = diffProfiles(snapshot, current);
  if (changed.length === 0) return { kind: 'match', snapshot, current };
  return { kind: 'mismatch', snapshot, current, changed };
}
