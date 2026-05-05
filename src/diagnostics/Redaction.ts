/**
 * T2-115: central redaction module for diagnostic exports. Pre-T2-115
 * the codebase had no redaction layer — every export site (support
 * bundle, crash report, error log) was one bug away from leaking
 * customer data: license keys, file paths with usernames, email
 * addresses, IP addresses, project content. Audit 5C Critical failure 9
 * + Required Priority 10 calls out the centralisation requirement so
 * the rules live in ONE file the security review can enforce.
 *
 * Defence-in-depth: license keys are ALWAYS redacted regardless of
 * caller-supplied options. Other categories are caller-controlled so
 * an opted-in project export (the user explicitly wants to share their
 * file with support) doesn't get crippled.
 */

export interface RedactionOptions {
  /** Defence-in-depth: ignored — license keys are always redacted. */
  redactLicenseKeys: boolean;
  redactFilePaths: boolean;
  redactEmails: boolean;
  redactIpAddresses: boolean;
  redactProjectNames: boolean;
  /**
   * When false, redactString never touches G-code-shaped lines (G0/G1
   * /M3/M5 etc) so the user opting in to share the actual G-code keeps
   * a useful artifact.
   */
  redactGcode: boolean;
  redactImages: boolean;
}

/**
 * Conservative defaults for an unknown context: every category that
 * could plausibly contain PII or licensable material is redacted.
 * Callers (support bundle, crash report) override per their UI.
 */
export function defaultRedactionOptions(): RedactionOptions {
  return {
    redactLicenseKeys: true,
    redactFilePaths: true,
    redactEmails: true,
    redactIpAddresses: true,
    redactProjectNames: false,
    redactGcode: false,
    redactImages: false,
  };
}

/**
 * Patterns. License-key shape mirrors the T1-80 / T2-93 license cache
 * format (UUID-style 8-4-4-4-12 hex). File-path matches Windows drive-
 * letter paths AND POSIX `/Users` / `/home` user dirs (the dirs that
 * carry usernames). Email + IPv4 are the standard shapes.
 */
const LICENSE_KEY = /[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}/gi;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const FILE_PATH = /(?:[A-Z]:[\\/]|\/(?:Users|home)\/)[^\s"'<>]+/g;

/**
 * Apply redaction to a string. Order matters: license-key first (tightest
 * pattern, lowest false-positive risk), then file paths (which can
 * contain @-signs from Windows-style usernames or IP-shaped folder
 * names), then emails + IPs.
 */
export function redactString(text: string, options: RedactionOptions): string {
  let out = text;
  // Always-on: license keys redacted regardless of options.redactLicenseKeys
  // (the field is kept for explicitness but the always-on rule is the
  // defence-in-depth contract).
  out = out.replace(LICENSE_KEY, '[REDACTED:LICENSE]');
  if (options.redactFilePaths) {
    out = out.replace(FILE_PATH, '[REDACTED:PATH]');
  }
  if (options.redactEmails) {
    out = out.replace(EMAIL, '[REDACTED:EMAIL]');
  }
  if (options.redactIpAddresses) {
    out = out.replace(IPV4, '[REDACTED:IP]');
  }
  return out;
}

const PROJECT_NAME_KEYS = new Set(['projectName', 'sceneName', 'fileName', 'name']);
const IMAGE_BUFFER_KEYS = new Set(['data', 'imageData', 'rawData', 'pixels', 'grayscaleData', 'adjustedData', 'processedData']);

function isGcodeLine(text: string): boolean {
  return /\b(?:G0|G1|G2|G3|G21|G90|G91|M3|M4|M5|M30|M2|S\d+|F\d+)\b/.test(text);
}

/**
 * Recursively redact an object tree. String leaves run through
 * redactString. Image-buffer-shaped leaves (Uint8Array / arrays under
 * known keys like `data`, `pixels`) are replaced with a placeholder
 * when redactImages is on. Object keys that look like a project name
 * have their string values replaced when redactProjectNames is on.
 *
 * Returns a new tree — input is not mutated.
 */
export function redactObject<T = unknown>(value: T, options: RedactionOptions): T {
  return _redactRec(value, options, null) as T;
}

function _redactRec(value: unknown, options: RedactionOptions, parentKey: string | null): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (parentKey != null && options.redactProjectNames && PROJECT_NAME_KEYS.has(parentKey)) {
      return '[REDACTED:PROJECT_NAME]';
    }
    if (!options.redactGcode && isGcodeLine(value)) {
      // Caller asked to keep G-code intact (they're sharing it on purpose).
      // Still redact license keys (defence-in-depth) but skip path/email/IP
      // — those don't legitimately appear in G-code anyway, but a comment
      // line could.
      return value.replace(LICENSE_KEY, '[REDACTED:LICENSE]');
    }
    return redactString(value, options);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray
      || value instanceof Int8Array || value instanceof Uint16Array
      || value instanceof Int16Array || value instanceof Uint32Array
      || value instanceof Int32Array || value instanceof Float32Array
      || value instanceof Float64Array) {
    if (options.redactImages
        || (parentKey != null && IMAGE_BUFFER_KEYS.has(parentKey))) {
      return `[REDACTED:BINARY:${value.byteLength}b]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => _redactRec(item, options, parentKey));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = _redactRec(v, options, k);
    }
    return out;
  }
  return value;
}

/**
 * Convenience for the support bundle: redacts a JSON-serialisable
 * value with the default options. Equivalent to
 * `redactObject(value, defaultRedactionOptions())`.
 */
export function redactDefault<T>(value: T): T {
  return redactObject(value, defaultRedactionOptions());
}
