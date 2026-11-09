// Saved camera calibrations name their camera only by its public address
// (ADR-692). Reading a record already does this; these helpers do it for a
// record about to be written, and for text an older version wrote whole,
// such as a remembered machine or a saved artwork's project. Pure core.

import { cameraSourceIdWithoutCredentials } from '../camera-capture-binding';
import type { CameraProfile } from '../camera-profile';
import type { CameraModelRecord } from './camera-model-record';

type SavedCameraFields = {
  readonly cameraModel?: CameraModelRecord | undefined;
  readonly otherCameraModels?: ReadonlyArray<CameraModelRecord> | undefined;
  readonly cameraProfile?: CameraProfile | undefined;
};

/** `device` with every saved camera named by its public address; itself when already so. */
export function withPublicCameraIdentities<T extends SavedCameraFields>(device: T): T {
  const cameraModel = device.cameraModel && publicRecord(device.cameraModel);
  const others = device.otherCameraModels?.map(publicRecord);
  const othersChanged = others?.some((record, i) => record !== device.otherCameraModels?.[i]);
  const cameraProfile = device.cameraProfile && publicProfile(device.cameraProfile);
  if (
    cameraModel === device.cameraModel &&
    othersChanged !== true &&
    cameraProfile === device.cameraProfile
  ) {
    return device;
  }
  return {
    ...device,
    ...(cameraModel === undefined ? {} : { cameraModel }),
    ...(others === undefined ? {} : { otherCameraModels: others }),
    ...(cameraProfile === undefined ? {} : { cameraProfile }),
  };
}

function publicProfile(profile: CameraProfile): CameraProfile {
  const source = profile.source;
  if (source?.kind !== 'rtsp') return profile;
  const url = cameraSourceIdWithoutCredentials(source.url);
  return url === source.url ? profile : { ...profile, source: { kind: 'rtsp', url } };
}

function publicRecord(record: CameraModelRecord): CameraModelRecord {
  const capture = record.capture;
  if (capture === undefined || capture.sourceKind === 'usb') return record;
  const sourceId = cameraSourceIdWithoutCredentials(capture.sourceId);
  return sourceId === capture.sourceId ? record : { ...record, capture: { ...capture, sourceId } };
}

/**
 * Rewrites, in place, the camera names in a device record parsed from JSON,
 * including the legacy camera profile's stream address. True when any changed.
 */
export function scrubParsedCameraIdentities(device: unknown): boolean {
  if (!isRecord(device)) return false;
  let changed = scrubParsedRecord(device['cameraModel']);
  const others = device['otherCameraModels'];
  if (Array.isArray(others)) {
    for (const record of others) changed = scrubParsedRecord(record) || changed;
  }
  const source = isRecord(device['cameraProfile']) ? device['cameraProfile']['source'] : undefined;
  if (isRecord(source) && typeof source['url'] === 'string') {
    const url = cameraSourceIdWithoutCredentials(source['url']);
    if (url !== source['url']) {
      source['url'] = url;
      changed = true;
    }
  }
  return changed;
}

function scrubParsedRecord(record: unknown): boolean {
  const capture = isRecord(record) ? record['capture'] : undefined;
  if (!isRecord(capture) || capture['sourceKind'] === 'usb') return false;
  const sourceId = capture['sourceId'];
  if (typeof sourceId !== 'string') return false;
  const safe = cameraSourceIdWithoutCredentials(sourceId);
  if (safe === sourceId) return false;
  capture['sourceId'] = safe;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
