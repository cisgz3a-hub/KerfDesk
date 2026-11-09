// Project text an older version wrote whole (a saved artwork's project, for
// example) gets its saved cameras named only by their public address
// (ADR-692) before it is shown, exported or kept again.

import { scrubParsedCameraIdentities } from '../../core/camera/model/public-camera-identity';

/** `json` with every saved camera named by its public address; `json` itself when already so. */
export function projectJsonWithPublicCameraIdentities(json: string): string {
  // Only text that names a camera at all is parsed again.
  if (!json.includes('"sourceId"') && !json.includes('"cameraProfile"')) return json;
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return json;
  }
  if (typeof root !== 'object' || root === null) return json;
  const changed = scrubParsedCameraIdentities((root as Record<string, unknown>)['device']);
  return changed ? `${JSON.stringify(root)}\n` : json;
}
