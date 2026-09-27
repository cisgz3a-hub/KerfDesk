// Shape rules for the optional head-position fields of a DeviceProfile
// (LightBurn gap LBG-M02, ADR-483): the laser finish position and the saved
// head positions. Project load and machine-profile import both use these
// guards so a file cannot pass one and fail the other, and export copies the
// fields through canonicalHeadPositions so nothing unexpected rides along.

import type { DeviceProfile, LaserFinishPosition, SavedHeadPosition } from './device-profile';

export function isLaserFinishPosition(value: unknown): value is LaserFinishPosition {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'stay') return true;
  return value['kind'] === 'bed' && isFiniteNumber(value['xMm']) && isFiniteNumber(value['yMm']);
}

export function isSavedHeadPosition(value: unknown): value is SavedHeadPosition {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    value['name'].trim().length > 0 &&
    (value['frame'] === 'bed' || value['frame'] === 'origin') &&
    isFiniteNumber(value['xMm']) &&
    isFiniteNumber(value['yMm'])
  );
}

/** Index of the first malformed saved position, -1 when all are valid. */
export function invalidSavedHeadPositionIndex(values: ReadonlyArray<unknown>): number {
  return values.findIndex((value) => !isSavedHeadPosition(value));
}

/** The two fields as plain copies with only their known keys; absent stays absent. */
export function canonicalHeadPositions(
  profile: Pick<DeviceProfile, 'laserFinishPosition' | 'savedPositions'>,
): Pick<DeviceProfile, 'laserFinishPosition' | 'savedPositions'> {
  const finish = profile.laserFinishPosition;
  const saved = profile.savedPositions;
  return {
    ...(finish === undefined
      ? {}
      : {
          laserFinishPosition:
            finish.kind === 'stay'
              ? { kind: 'stay' }
              : { kind: 'bed', xMm: finish.xMm, yMm: finish.yMm },
        }),
    ...(saved === undefined
      ? {}
      : {
          savedPositions: saved.map(({ name, frame, xMm, yMm }) => ({ name, frame, xMm, yMm })),
        }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
