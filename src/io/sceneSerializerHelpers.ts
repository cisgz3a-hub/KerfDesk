/**
 * T1-159: pure helpers extracted from SceneSerializer. Pre-T1-159
 * these 7 helpers (3 validators, 2 version parsers, 2 base64
 * encoders) lived inside the 667-line serializer file mixed with
 * the load/save orchestration. All pure — they throw on bad input
 * but don't touch storage or globals.
 *
 *   Validation:
 *     - validateRequired(obj, field, expectedType)
 *     - validateArray(obj, field)
 *     - validateTransform(t, context): pin all 6 matrix slots are
 *       finite (catch NaN / Infinity from corrupted files).
 *
 *   Version parsing:
 *     - fileFormatMajor(version): "1.2" → 1
 *     - fileFormatMinor(version): "1.2" → 2 (defaults to 0)
 *
 *   Base64:
 *     - uint8ToBase64(arr): used because JSON.stringify mangles
 *       Uint8Array into a sparse {"0":128,...} object.
 *     - base64ToUint8(b64): inverse.
 *
 * Throwing functions use the user-visible error strings the
 * serializer used pre-extraction; the messages are part of the
 * contract.
 */

/**
 * Throw `Invalid file: missing required field '<field>'` when the
 * field is undefined or null; throw `Invalid file: '<field>' must
 * be <expectedType>, got <typeof obj[field]>` when present but the
 * wrong primitive type. Used by deserialization to surface corrupt
 * file errors before they propagate into the scene.
 */
export function validateRequired(obj: any, field: string, expectedType: string): void {
  if (obj[field] === undefined || obj[field] === null) {
    throw new Error(`Invalid file: missing required field '${field}'`);
  }
  if (typeof obj[field] !== expectedType) {
    throw new Error(`Invalid file: '${field}' must be ${expectedType}, got ${typeof obj[field]}`);
  }
}

/**
 * Throw `Invalid file: '<field>' must be an array` when
 * `Array.isArray(obj[field])` returns false. (Array is a non-
 * primitive type so `typeof` returns `'object'`, which is why this
 * needs its own validator.)
 */
export function validateArray(obj: any, field: string): void {
  if (!Array.isArray(obj[field])) {
    throw new Error(`Invalid file: '${field}' must be an array`);
  }
}

/**
 * Validate all 6 components of a 2D affine transform (a, b, c, d,
 * tx, ty) are finite numbers. Catches NaN / Infinity from corrupted
 * files before they silently propagate through rendering and
 * toolpath generation. Throws the per-field error with the value
 * that triggered the failure for diagnostic value.
 */
export function validateTransform(t: any, context: string): void {
  const fields = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  for (const f of fields) {
    if (typeof t[f] !== 'number' || !Number.isFinite(t[f])) {
      throw new Error(`Invalid file: transform.${f} in ${context} is not a finite number (got ${t[f]})`);
    }
  }
}

/**
 * Major version number from envelope `version` (e.g. "1.2" → 1).
 * Missing or empty → 1 (the laserforge format major). Anything that
 * doesn't start with digits returns NaN so the caller can refuse to
 * load.
 */
export function fileFormatMajor(version: unknown): number {
  if (version == null || version === '') return 1;
  const s = String(version).trim();
  const m = /^(\d+)/.exec(s);
  if (!m) return NaN;
  return parseInt(m[1], 10);
}

/**
 * Minor version number from envelope `version` (e.g. "1.2" → 2).
 * Missing or empty → 0. Missing minor (e.g. "1") → 0.
 */
export function fileFormatMinor(version: unknown): number {
  if (version == null || version === '') return 0;
  const s = String(version).trim();
  const m = /^\d+\.(\d+)/.exec(s);
  if (!m) return 0;
  return parseInt(m[1], 10);
}

/**
 * Encode a Uint8Array as a base64 string for JSON safety. Used
 * because `JSON.stringify` turns Uint8Array into the sparse object
 * `{"0":128,"1":64,...}` which doesn't reconstruct on parse.
 */
export function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string back into a Uint8Array. Inverse of uint8ToBase64. */
export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}
