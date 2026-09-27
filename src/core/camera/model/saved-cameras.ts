// The calibrations of every camera on one machine (ADR-445). A machine can have
// several cameras, such as the built-in one and a USB camera over a large bed,
// and each keeps its own lens and pose. Each saved model names the camera it
// was fitted on (its capture binding), so the model in use follows whichever
// camera is running and switching cameras never needs a recalibration.
// `cameraModel` stays the newest calibration, which older KerfDesk versions
// still read; the others sit in `otherCameraModels`. Pure core.

import type { DeviceProfile } from '../../devices/device-profile';
import type { CameraCaptureBinding } from '../camera-capture-binding';
import { normalizeCameraModelRecord, type CameraModelRecord } from './camera-model-record';

/** What names one camera: its kind, id and, for network cameras, its query. */
export type CameraSourceIdentity = Pick<
  CameraCaptureBinding,
  'sourceKind' | 'sourceId' | 'queryFingerprint'
>;

type SavedCameraFields = Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>;

/** Both fields spelled out, so saving or forgetting can also clear them. */
export type SavedCameraPatch = {
  readonly cameraModel: CameraModelRecord | undefined;
  readonly otherCameraModels: ReadonlyArray<CameraModelRecord> | undefined;
};

/** Every saved calibration, the newest first. */
export function savedCameraModels(profile: SavedCameraFields): ReadonlyArray<CameraModelRecord> {
  return [
    ...(profile.cameraModel === undefined ? [] : [profile.cameraModel]),
    ...(profile.otherCameraModels ?? []),
  ];
}

/** True when `model` was fitted on the camera `source` names. */
export function modelBelongsTo(model: CameraModelRecord, source: CameraSourceIdentity): boolean {
  const saved = model.capture;
  return (
    saved !== undefined &&
    saved.sourceKind === source.sourceKind &&
    saved.sourceId === source.sourceId &&
    (source.sourceKind === 'usb' || saved.queryFingerprint === source.queryFingerprint)
  );
}

/** The saved calibration of the camera `source` names, if there is one. */
export function savedModelFor(
  profile: SavedCameraFields,
  source: CameraSourceIdentity,
): CameraModelRecord | undefined {
  return savedCameraModels(profile).find((model) => modelBelongsTo(model, source));
}

/**
 * The calibration that counts as `source`'s own: the one fitted on it, or a
 * newest calibration from before cameras were recorded, which may well be
 * this camera and is all an older profile has.
 */
export function ownModelFor(
  profile: SavedCameraFields,
  source: CameraSourceIdentity,
): CameraModelRecord | undefined {
  return (
    savedModelFor(profile, source) ??
    (profile.cameraModel?.capture === undefined ? profile.cameraModel : undefined)
  );
}

/**
 * The calibration to use with `source`: its own when saved, otherwise the
 * newest one, which then reports that it belongs to another camera exactly as
 * a single saved calibration always has. With no running camera, the newest.
 */
export function cameraModelInUse(
  profile: SavedCameraFields,
  source: CameraSourceIdentity | null,
): CameraModelRecord | undefined {
  return (source === null ? undefined : savedModelFor(profile, source)) ?? profile.cameraModel;
}

/**
 * The profile fields after saving `record`: it becomes the newest, and it
 * replaces any earlier calibration of the same camera. Calibrations of other
 * cameras are kept. A model with no capture binding cannot be told apart from
 * the others: saving one replaces only the newest, and saving a bound one
 * drops an unbound one, which no camera could ever select.
 */
export function withSavedCameraModel(
  profile: SavedCameraFields,
  record: CameraModelRecord,
): SavedCameraPatch {
  const capture = record.capture;
  const others =
    capture === undefined
      ? (profile.otherCameraModels ?? [])
      : savedCameraModels(profile).filter(
          (model) => model.capture !== undefined && !modelBelongsTo(model, capture),
        );
  return { cameraModel: record, otherCameraModels: nonEmpty(others) };
}

/** The profile fields after forgetting `record`; the next newest moves up. */
export function withoutSavedCameraModel(
  profile: SavedCameraFields,
  record: CameraModelRecord,
): SavedCameraPatch {
  const [newest, ...others] = savedCameraModels(profile).filter((model) => model !== record);
  return { cameraModel: newest, otherCameraModels: nonEmpty(others) };
}

/**
 * Saved calibrations of the machine's other cameras, read from a file. An
 * invalid entry, or one with no capture binding (it could not be matched to a
 * camera), is dropped rather than trusted, like an invalid `cameraModel`.
 */
export function normalizeOtherCameraModels(
  value: unknown,
): ReadonlyArray<CameraModelRecord> | undefined {
  if (!Array.isArray(value)) return undefined;
  const models = value
    .map((entry) => normalizeCameraModelRecord(entry))
    .filter((model): model is CameraModelRecord => model?.capture !== undefined);
  return nonEmpty(models);
}

function nonEmpty<T>(items: ReadonlyArray<T>): ReadonlyArray<T> | undefined {
  return items.length === 0 ? undefined : items;
}
