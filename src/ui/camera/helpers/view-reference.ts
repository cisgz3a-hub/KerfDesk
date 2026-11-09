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

/** One reference per calibration: the camera it was fitted on, and when. */
function keyFor(record: CameraModelRecord): string {
  renameOlderKeys();
  return `${KEY_PREFIX}${record.capture?.sourceId ?? 'unbound'}@${record.calibratedAt}`;
}

let olderKeysRenamed = false;

// Older versions could name a network camera here by more than its public
// address (ADR-692); such a reference moves to the key it has now, once a run.
function renameOlderKeys(): void {
  if (olderKeysRenamed) return;
  olderKeysRenamed = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(KEY_PREFIX)) continue;
      const at = key.lastIndexOf('@');
      const sourceId = key.slice(KEY_PREFIX.length, at);
      if (at < KEY_PREFIX.length || !sourceId.includes('://')) continue;
      const renamed = `${KEY_PREFIX}${cameraSourceIdWithoutCredentials(sourceId)}${key.slice(at)}`;
      if (renamed === key) continue;
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

/** Test seam: the next use renames older keys again. */
export function resetViewReferenceKeyRenameForTests(): void {
  olderKeysRenamed = false;
}

export function saveViewReference(record: CameraModelRecord, thumb: ViewThumbnail): void {
  try {
    // Keep one reference per camera: an older calibration's goes with it.
    renameOlderKeys();
    const prefix = `${KEY_PREFIX}${record.capture?.sourceId ?? 'unbound'}@`;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(prefix)) localStorage.removeItem(key);
    }
    localStorage.setItem(
      keyFor(record),
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
