export const MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES = 64 * 1024 * 1024;

const OBJECT_OVERHEAD_BYTES = 16;
const ENTRY_OVERHEAD_BYTES = 8;
const PRIMITIVE_BYTES = 24;
/** Any UTF-16 code unit outside ASCII. Written without control characters. */
const NON_ASCII_CODE_UNIT = /[\u0080-￿]/;

/** Conservative, allocation-free structured-clone size estimate. An all-ASCII
 * string counts one byte per character, which is what the structured clone of
 * every browser engine and UTF-8 both store (G-code is ASCII); any other string
 * counts the maximum UTF-8 bytes per UTF-16 code unit. The flat three bytes a
 * character once charged made G-code over about 22 million characters look
 * like 64 MiB, so large photo engravings silently lost their recovery archive
 * (ADR-341 Amendment 3). Traversal stops as soon as the caller's limit is
 * exceeded. Views charge their entire backing buffer because structured clone
 * copies that buffer, with shared backings counted once. Map, Set, Blob, and
 * other supported structured-clone containers are accounted explicitly;
 * unknown containers fail closed rather than disappearing from the estimate. */
export function estimateExecutionArtifactBytes(
  value: unknown,
  stopAfterBytes = Number.MAX_SAFE_INTEGER,
  allowTransientFunctions = false,
): number {
  try {
    let total = 0;
    const pending: unknown[] = [value];
    const seenContainers = new WeakSet<object>();
    const seenBackingBuffers = new WeakSet<object>();
    while (pending.length > 0 && total <= stopAfterBytes) {
      const item = pending.pop();
      total = boundedAdd(
        total,
        executionArtifactValueBytes(
          item,
          pending,
          seenContainers,
          seenBackingBuffers,
          allowTransientFunctions,
        ),
      );
    }
    return total;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function executionArtifactValueBytes(
  value: unknown,
  pending: unknown[],
  seenContainers: WeakSet<object>,
  seenBackingBuffers: WeakSet<object>,
  allowTransientFunctions: boolean,
): number {
  const primitiveBytes = executionArtifactPrimitiveBytes(value, allowTransientFunctions);
  if (primitiveBytes !== null) return primitiveBytes;
  const objectValue = value as object;
  const binaryBytes = executionArtifactBinaryBytes(objectValue, seenContainers, seenBackingBuffers);
  return binaryBytes ?? cloneContainerBytes(objectValue, pending, seenContainers);
}

function executionArtifactPrimitiveBytes(
  value: unknown,
  allowTransientFunctions: boolean,
): number | null {
  if (typeof value === 'string') return stringBytes(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return PRIMITIVE_BYTES;
  }
  if (typeof value === 'function' && allowTransientFunctions) return 0;
  if (typeof value !== 'object') return Number.MAX_SAFE_INTEGER;
  return null;
}

function executionArtifactBinaryBytes(
  value: object,
  seenContainers: WeakSet<object>,
  seenBackingBuffers: WeakSet<object>,
): number | null {
  if (value instanceof ArrayBuffer) {
    return backingBufferBytes(value, seenBackingBuffers);
  }
  if (isSharedArrayBuffer(value)) {
    return backingBufferBytes(value, seenBackingBuffers);
  }
  if (ArrayBuffer.isView(value)) {
    if (seenContainers.has(value)) return 0;
    seenContainers.add(value);
    return boundedAdd(OBJECT_OVERHEAD_BYTES, backingBufferBytes(value.buffer, seenBackingBuffers));
  }
  return null;
}

function cloneContainerBytes(
  value: object,
  pending: unknown[],
  seenContainers: WeakSet<object>,
): number {
  if (seenContainers.has(value)) return 0;
  seenContainers.add(value);
  const structuredCloneBytes = supportedCloneContainerBytes(value, pending);
  if (structuredCloneBytes !== null) return structuredCloneBytes;
  if (!isPlainCloneContainer(value)) return Number.MAX_SAFE_INTEGER;
  let bytes = Array.isArray(value)
    ? boundedAdd(OBJECT_OVERHEAD_BYTES, value.length * ENTRY_OVERHEAD_BYTES)
    : OBJECT_OVERHEAD_BYTES;
  for (const [key, child] of Object.entries(value)) {
    bytes = boundedAdd(bytes, stringBytes(key) + ENTRY_OVERHEAD_BYTES);
    pending.push(child);
  }
  return bytes;
}

/** Stored bytes of a string: one per character when all of it is ASCII, else
 * the maximum UTF-8 bytes per UTF-16 code unit. */
export function stringBytes(value: string): number {
  return NON_ASCII_CODE_UNIT.test(value) ? value.length * 3 : value.length;
}

function supportedCloneContainerBytes(value: object, pending: unknown[]): number | null {
  if (value instanceof Map) return mapBytes(value, pending);
  if (value instanceof Set) return setBytes(value, pending);
  if (typeof Blob !== 'undefined' && value instanceof Blob) return blobBytes(value);
  if (value instanceof Date) return OBJECT_OVERHEAD_BYTES + PRIMITIVE_BYTES;
  if (value instanceof RegExp) {
    return boundedAdd(
      OBJECT_OVERHEAD_BYTES,
      stringBytes(value.source) + stringBytes(value.flags) + PRIMITIVE_BYTES,
    );
  }
  return null;
}

function mapBytes(value: Map<unknown, unknown>, pending: unknown[]): number {
  const bytes = boundedAdd(OBJECT_OVERHEAD_BYTES, value.size * ENTRY_OVERHEAD_BYTES * 2);
  for (const [key, child] of value) {
    pending.push(key, child);
  }
  return bytes;
}

function setBytes(value: Set<unknown>, pending: unknown[]): number {
  const bytes = boundedAdd(OBJECT_OVERHEAD_BYTES, value.size * ENTRY_OVERHEAD_BYTES);
  for (const child of value) pending.push(child);
  return bytes;
}

function blobBytes(value: Blob): number {
  let bytes = boundedAdd(OBJECT_OVERHEAD_BYTES, value.size);
  bytes = boundedAdd(bytes, stringBytes(value.type) + ENTRY_OVERHEAD_BYTES);
  if (typeof File !== 'undefined' && value instanceof File) {
    bytes = boundedAdd(bytes, stringBytes(value.name) + PRIMITIVE_BYTES);
  }
  return bytes;
}

function backingBufferBytes(buffer: ArrayBufferLike, seenBackingBuffers: WeakSet<object>): number {
  const identity = buffer as object;
  if (seenBackingBuffers.has(identity)) return 0;
  seenBackingBuffers.add(identity);
  return boundedAdd(buffer.byteLength, OBJECT_OVERHEAD_BYTES);
}

function isSharedArrayBuffer(value: object): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

function isPlainCloneContainer(value: object): boolean {
  if (Array.isArray(value)) return true;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertExecutionArtifactSizeWithinBudget(
  value: unknown,
  additionalBinaryBytes = 0,
  allowTransientFunctions = false,
): void {
  measureExecutionArtifactBytesWithinBudget(value, additionalBinaryBytes, allowTransientFunctions);
}

/** Enforce the archive budget and return the measurement in ONE traversal.
 *
 * The returned total is the complete estimate, never an early-exit lower
 * bound: the walk stops early only once it passes the remaining budget, and
 * that is exactly the case this throws on. Callers that need both the guard
 * and the recorded size must use this instead of asserting and then
 * estimating again — the traversal visits one node per motion-manifest point,
 * so a second pass costs real time before the first wire write. */
export function measureExecutionArtifactBytesWithinBudget(
  value: unknown,
  additionalBinaryBytes = 0,
  allowTransientFunctions = false,
): number {
  if (
    !Number.isSafeInteger(additionalBinaryBytes) ||
    additionalBinaryBytes < 0 ||
    additionalBinaryBytes > MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES
  ) {
    throw new Error('Execution artifact exceeds the safe archive size.');
  }
  const remaining = MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES - additionalBinaryBytes;
  const bytes = estimateExecutionArtifactBytes(value, remaining, allowTransientFunctions);
  if (bytes > remaining) {
    throw new Error('Execution artifact exceeds the safe archive size.');
  }
  return bytes;
}

const memoizedArtifactBytes = new WeakMap<object, number>();

/** Identity-memoized full estimate for an immutable archived artifact.
 *
 * Snapshot hydration re-measures every retained execution-history artifact on
 * every refresh, and a refresh runs after each recovery mutation — including
 * the one that arms a fresh Start. The retained set is bounded by run count
 * and bytes, not by node count, so twenty traced jobs cost seconds of
 * main-thread work per refresh. Archived artifacts are immutable and the
 * snapshot coordinator deliberately hands the same object references back
 * across refreshes, so caching on identity returns the identical number
 * without re-walking. */
export function memoizedExecutionArtifactBytes(artifact: object): number {
  const cached = memoizedArtifactBytes.get(artifact);
  if (cached !== undefined) return cached;
  const bytes = estimateExecutionArtifactBytes(artifact);
  memoizedArtifactBytes.set(artifact, bytes);
  return bytes;
}

function boundedAdd(total: number, value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && total <= Number.MAX_SAFE_INTEGER - value
    ? total + value
    : Number.MAX_SAFE_INTEGER;
}
