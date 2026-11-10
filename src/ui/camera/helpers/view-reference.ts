// The camera's view when its calibration was last known good (ADR-663
// Amendment 3): a small grey thumbnail kept on this computer per saved
// calibration, taken from the calibration photo, from a check that found the
// camera where it was, or right after a nudge fix. The "camera moved?" check
// compares later pictures with it. Machine-local like the other camera
// preferences: it describes this computer's camera, not the project.

import { cameraSourceIdWithoutCredentials } from '../../../core/camera/camera-capture-binding';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { ViewThumbnail } from '../../../core/camera/model/view-shift';

const KEY_PREFIX = 'laserforge.camera.viewReference.v1:';

/**
 * The camera a reference belongs to: its public address and, for a network
 * camera, its keyed fingerprint, since several cameras can share one address
 * (ADR-692 Amendment 1).
 */
function cameraName(record: CameraModelRecord): string {
  const capture = record.capture;
  if (capture === undefined) return 'unbound';
  const fingerprint = capture.queryFingerprint;
  return fingerprint === undefined ? capture.sourceId : `${capture.sourceId}#${fingerprint}`;
}

/** One reference per calibration: the camera it was fitted on, and when. */
function keyFor(record: CameraModelRecord): string {
  renameOlderKeys();
  const key = `${KEY_PREFIX}${cameraName(record)}@${record.calibratedAt}`;
  adoptUnnamedKey(record, key);
  return key;
}

// A reference kept before the fingerprint was part of its key moves to it.
function adoptUnnamedKey(record: CameraModelRecord, key: string): void {
  const older = `${KEY_PREFIX}${record.capture?.sourceId ?? 'unbound'}@${record.calibratedAt}`;
  if (older === key) return;
  try {
    const value = localStorage.getItem(older);
    if (value === null) return;
    localStorage.removeItem(older);
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: nothing is kept to move.
  }
}

let olderKeysRenamed = false;

// Older versions could name a network camera here by more than its public
// address (ADR-692 and Amendment 1); such a reference moves to the key it has
// now, once a run.
function renameOlderKeys(): void {
  if (olderKeysRenamed) return;
  olderKeysRenamed = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      const renamed = key === null ? null : publicKey(key);
      if (key === null || renamed === null || renamed === key) continue;
      const value = localStorage.getItem(key);
      localStorage.removeItem(key);
      if (value !== null && localStorage.getItem(renamed) === null) {
        localStorage.setItem(renamed, value);
      }
    }
  } catch {
    // Storage unavailable: nothing is kept to rename.
  }
}

// `key` with its camera named by its public address; null when it names no network camera.
function publicKey(key: string): string | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const at = key.lastIndexOf('@');
  const name = key.slice(KEY_PREFIX.length, at);
  if (at < KEY_PREFIX.length || !name.includes('://')) return null;
  const hash = /#hmac-sha256:[0-9a-f]{64}$/.exec(name)?.[0] ?? '';
  const sourceId = cameraSourceIdWithoutCredentials(name.slice(0, name.length - hash.length));
  return `${KEY_PREFIX}${sourceId}${hash}${key.slice(at)}`;
}

/** Test seam: the next use renames older keys again. */
export function resetViewReferenceKeyRenameForTests(): void {
  olderKeysRenamed = false;
}

export function saveViewReference(record: CameraModelRecord, thumb: ViewThumbnail): void {
  try {
    // Keep one reference per camera: an older calibration's goes with it.
    const key = keyFor(record);
    const prefix = `${KEY_PREFIX}${cameraName(record)}@`;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const stored = localStorage.key(i);
      if (stored !== null && stored.startsWith(prefix)) localStorage.removeItem(stored);
    }
    localStorage.setItem(
      key,
      JSON.stringify({ width: thumb.width, height: thumb.height, data: toBase64(thumb.data) }),
    );
  } catch {
    // Storage full or unavailable: the moved check simply has nothing to compare with.
  }
}

/** Whether a reference view is kept for `record`, without reading it. */
export function hasViewReference(record: CameraModelRecord): boolean {
  try {
    return localStorage.getItem(keyFor(record)) !== null;
  } catch {
    return false;
  }
}

export function loadViewReference(record: CameraModelRecord): ViewThumbnail | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(keyFor(record)) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return null;
    const { width, height, data } = stored as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number' || typeof data !== 'string') {
      return null;
    }
    const bytes = fromBase64(data);
    return bytes.length === width * height ? { width, height, data: bytes } : null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
