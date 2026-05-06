/**
 * T2-127: per-namespace storage size limits. Pre-T2-127
 * `electron/storage.ts:44-49` accepted any string value with no
 * size limit — a renderer (legitimate OR compromised) could call
 * `storageSet(key, hugeValue)` and fill userData / crash the main
 * process during JSON serialisation / make the file unreadable.
 *
 * Audit 5D DoS vector 6 + Required Priority 13. T2-127 ships the
 * `StorageNamespace` taxonomy + per-namespace caps + a check helper.
 * Threading the check into the typed IPC layer (T2-120) is filed
 * as T2-127-followup.
 */

export type StorageNamespace =
  | 'profiles'
  | 'materials'
  | 'autosave'
  | 'jobLogs'
  | 'replays'
  | 'settings'
  | 'licenseCache'
  | 'history'
  | 'correlationState'
  | 'other';

/**
 * Per-namespace caps. Values come straight from the audit's
 * recommendation:
 *
 * - profiles / materials: 100 KB per value, 5 MB total — these are
 *   small JSON records; no legitimate single profile or preset
 *   exceeds 100 KB.
 * - autosave: 50 MB / 50 MB — real projects with embedded images
 *   legitimately reach 30+ MB.
 * - jobLogs: 5 MB per value, 100 MB total — a long job's RX/TX
 *   stream can be megabytes; T2-112 compaction reduces this.
 * - settings: 50 KB / 1 MB — tiny.
 * - licenseCache: 10 KB / 10 KB — a license fits in much less.
 * - replays: 5 MB per value, 50 MB total — replay frames + state.
 * - history: 5 MB / 50 MB — undo stack snapshots (T2-82 caps history).
 * - correlationState: 10 KB / 100 KB — T2-117 IDs are tiny.
 * - other: 1 MB per value, 10 MB total — catch-all + alerting.
 */
export interface NamespaceLimit {
  maxValueBytes: number;
  maxTotalBytes: number;
}

const KB = 1024;
const MB = 1024 * 1024;

export const NAMESPACE_LIMITS: Record<StorageNamespace, NamespaceLimit> = {
  profiles: { maxValueBytes: 100 * KB, maxTotalBytes: 5 * MB },
  materials: { maxValueBytes: 100 * KB, maxTotalBytes: 5 * MB },
  autosave: { maxValueBytes: 50 * MB, maxTotalBytes: 50 * MB },
  jobLogs: { maxValueBytes: 5 * MB, maxTotalBytes: 100 * MB },
  replays: { maxValueBytes: 5 * MB, maxTotalBytes: 50 * MB },
  settings: { maxValueBytes: 50 * KB, maxTotalBytes: 1 * MB },
  licenseCache: { maxValueBytes: 10 * KB, maxTotalBytes: 10 * KB },
  history: { maxValueBytes: 5 * MB, maxTotalBytes: 50 * MB },
  correlationState: { maxValueBytes: 10 * KB, maxTotalBytes: 100 * KB },
  other: { maxValueBytes: 1 * MB, maxTotalBytes: 10 * MB },
};

export type StorageLimitErrorKind =
  | 'value-too-large'
  | 'namespace-full'
  | 'invalid-utf8';

export class StorageLimitError extends Error {
  override readonly name = 'StorageLimitError';
  readonly kind: StorageLimitErrorKind;
  readonly namespace: StorageNamespace;
  readonly observed: number;
  readonly limit: number;

  constructor(args: {
    kind: StorageLimitErrorKind;
    namespace: StorageNamespace;
    observed: number;
    limit: number;
    message: string;
  }) {
    super(args.message);
    this.kind = args.kind;
    this.namespace = args.namespace;
    this.observed = args.observed;
    this.limit = args.limit;
    Object.setPrototypeOf(this, StorageLimitError.prototype);
  }
}

/**
 * UTF-8 byte length of a string. Mirrors `Buffer.byteLength(s,
 * 'utf8')` without depending on Node's Buffer (so this module
 * works in browser-only contexts too).
 */
export function byteLengthUtf8(value: string): number {
  let len = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) len += 1;
    else if (code < 0x800) len += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: pair contributes 4 bytes total
      if (i + 1 < value.length) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          len += 4;
          i += 1;
          continue;
        }
      }
      // Lone surrogate — encode as 3 bytes (replacement)
      len += 3;
    } else {
      len += 3;
    }
  }
  return len;
}

/**
 * Check that a single value fits the per-value limit for its
 * namespace. Throws `StorageLimitError` with kind='value-too-large'
 * when over.
 */
export function checkValueSize(
  namespace: StorageNamespace,
  value: string,
): void {
  const limit = NAMESPACE_LIMITS[namespace];
  const bytes = byteLengthUtf8(value);
  if (bytes > limit.maxValueBytes) {
    throw new StorageLimitError({
      kind: 'value-too-large',
      namespace,
      observed: bytes,
      limit: limit.maxValueBytes,
      message: `Value too large for namespace '${namespace}': ${bytes} bytes > ${limit.maxValueBytes} byte limit.`,
    });
  }
}

/**
 * Check that adding `incomingBytes` to the existing `currentBytes`
 * total wouldn't exceed the namespace total. Caller computes
 * `currentBytes` (sum of existing values) and `incomingBytes` (new
 * value's UTF-8 length).
 */
export function checkNamespaceTotal(args: {
  namespace: StorageNamespace;
  currentBytes: number;
  incomingBytes: number;
}): void {
  const limit = NAMESPACE_LIMITS[args.namespace];
  const projected = args.currentBytes + args.incomingBytes;
  if (projected > limit.maxTotalBytes) {
    throw new StorageLimitError({
      kind: 'namespace-full',
      namespace: args.namespace,
      observed: projected,
      limit: limit.maxTotalBytes,
      message: `Namespace '${args.namespace}' is full: ${projected} bytes would exceed ${limit.maxTotalBytes} byte total.`,
    });
  }
}

/**
 * Combined check — runs both checkValueSize and checkNamespaceTotal.
 * The typed IPC layer (T2-120) calls this on every save.
 *
 * `currentBytes` is the SUM of existing values for the namespace
 * MINUS the existing value at this key (i.e. compute the size as
 * if the existing key weren't there, since it's about to be
 * overwritten). The caller is responsible for that subtraction.
 */
export function checkSaveAllowed(args: {
  namespace: StorageNamespace;
  value: string;
  currentBytes: number;
}): void {
  checkValueSize(args.namespace, args.value);
  checkNamespaceTotal({
    namespace: args.namespace,
    currentBytes: args.currentBytes,
    incomingBytes: byteLengthUtf8(args.value),
  });
}

/**
 * User-facing message for a StorageLimitError. The error already
 * has a developer message; this one is shaped for the toast/banner.
 */
export function storageLimitUserMessage(err: StorageLimitError): string {
  switch (err.kind) {
    case 'value-too-large': {
      const observedKb = (err.observed / 1024).toFixed(0);
      const limitKb = (err.limit / 1024).toFixed(0);
      return `Cannot save ${err.namespace} entry: value is ${observedKb} KB, the maximum is ${limitKb} KB.`;
    }
    case 'namespace-full': {
      const observedMb = (err.observed / 1024 / 1024).toFixed(1);
      const limitMb = (err.limit / 1024 / 1024).toFixed(0);
      return `${err.namespace} storage is full (${observedMb} MB of ${limitMb} MB). Remove old entries to continue.`;
    }
    case 'invalid-utf8':
      return `Cannot save ${err.namespace} entry: invalid character data.`;
  }
}
