import {
  isCurrentExecutionArtifact,
  type ExecutionArtifactV1,
} from '../state/recovery/execution-artifact';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import { sha256Utf8 } from '../state/recovery/execution-provenance';

export const EXECUTION_ARTIFACT_EXPORT_FORMAT = 'kerfdesk-execution-artifact';
export const EXECUTION_ARTIFACT_EXPORT_SCHEMA_VERSION = 1;
export const EXECUTION_ARTIFACT_EXPORT_ENCODING = 'tagged-binary-json-v1';

const BINARY_TAG = '__kerfdesk_binary_v1__';
const EXPORT_ENVELOPE_DOMAIN = 'KerfDesk execution artifact export v1\0';
const MAX_CODEC_DEPTH = 128;

type BinaryType =
  | 'ArrayBuffer'
  | 'DataView'
  | 'Int8Array'
  | 'Uint8Array'
  | 'Uint8ClampedArray'
  | 'Int16Array'
  | 'Uint16Array'
  | 'Int32Array'
  | 'Uint32Array'
  | 'Float32Array'
  | 'Float64Array'
  | 'BigInt64Array'
  | 'BigUint64Array';
type TypedArrayType = Exclude<BinaryType, 'ArrayBuffer' | 'DataView'>;

const TYPED_ARRAY_FACTORIES = {
  Int8Array: (buffer: ArrayBuffer) => new Int8Array(buffer),
  Uint8Array: (buffer: ArrayBuffer) => new Uint8Array(buffer),
  Uint8ClampedArray: (buffer: ArrayBuffer) => new Uint8ClampedArray(buffer),
  Int16Array: (buffer: ArrayBuffer) => new Int16Array(buffer),
  Uint16Array: (buffer: ArrayBuffer) => new Uint16Array(buffer),
  Int32Array: (buffer: ArrayBuffer) => new Int32Array(buffer),
  Uint32Array: (buffer: ArrayBuffer) => new Uint32Array(buffer),
  Float32Array: (buffer: ArrayBuffer) => new Float32Array(buffer),
  Float64Array: (buffer: ArrayBuffer) => new Float64Array(buffer),
  BigInt64Array: (buffer: ArrayBuffer) => new BigInt64Array(buffer),
  BigUint64Array: (buffer: ArrayBuffer) => new BigUint64Array(buffer),
} satisfies Record<TypedArrayType, (buffer: ArrayBuffer) => ArrayBufferView>;

type EncodedBinary = {
  readonly [BINARY_TAG]: {
    readonly type: BinaryType;
    readonly byteLength: number;
    readonly elementLength: number;
    readonly base64: string;
  };
};

type EncodedJson =
  | null
  | boolean
  | number
  | string
  | EncodedBinary
  | ReadonlyArray<EncodedJson>
  | { readonly [key: string]: EncodedJson };

type ExecutionArtifactExportBodyV1 = {
  readonly format: typeof EXECUTION_ARTIFACT_EXPORT_FORMAT;
  readonly schemaVersion: typeof EXECUTION_ARTIFACT_EXPORT_SCHEMA_VERSION;
  readonly encoding: typeof EXECUTION_ARTIFACT_EXPORT_ENCODING;
  readonly artifact: EncodedJson;
};

export type ExecutionArtifactExportV1 = ExecutionArtifactExportBodyV1 & {
  readonly envelopeSha256: `sha256:${string}`;
};

/** Serialize an exact artifact without JSON's lossy typed-array object coercion. */
export async function serializeExecutionArtifactExport(
  artifact: ExecutionArtifactV1,
): Promise<string> {
  if (
    !isCurrentExecutionArtifact(artifact) ||
    !(await executionArtifactIntegrityIsValid(artifact))
  ) {
    throw new Error('Only a current integrity-verified execution artifact can be exported.');
  }
  const body: ExecutionArtifactExportBodyV1 = {
    format: EXECUTION_ARTIFACT_EXPORT_FORMAT,
    schemaVersion: EXECUTION_ARTIFACT_EXPORT_SCHEMA_VERSION,
    encoding: EXECUTION_ARTIFACT_EXPORT_ENCODING,
    artifact: encodeValue(artifact),
  };
  const envelope: ExecutionArtifactExportV1 = {
    ...body,
    envelopeSha256: await computeExecutionArtifactExportEnvelopeSha256(body),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** Strict decoder retained for round-trip verification and a future import UI. */
export async function decodeExecutionArtifactExport(
  serialized: string,
): Promise<ExecutionArtifactV1> {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) throw new Error('Execution artifact export is not an object.');
  if (
    parsed['format'] !== EXECUTION_ARTIFACT_EXPORT_FORMAT ||
    parsed['schemaVersion'] !== EXECUTION_ARTIFACT_EXPORT_SCHEMA_VERSION ||
    parsed['encoding'] !== EXECUTION_ARTIFACT_EXPORT_ENCODING ||
    !isSha256(parsed['envelopeSha256'])
  ) {
    throw new Error('Execution artifact export envelope is unsupported or malformed.');
  }
  const body: ExecutionArtifactExportBodyV1 = {
    format: EXECUTION_ARTIFACT_EXPORT_FORMAT,
    schemaVersion: EXECUTION_ARTIFACT_EXPORT_SCHEMA_VERSION,
    encoding: EXECUTION_ARTIFACT_EXPORT_ENCODING,
    artifact: parsed['artifact'] as EncodedJson,
  };
  const expected = await computeExecutionArtifactExportEnvelopeSha256(body);
  if (parsed['envelopeSha256'] !== expected) {
    throw new Error('Execution artifact export envelope digest does not match.');
  }
  const decoded = decodeValue(body.artifact);
  if (!isCurrentExecutionArtifact(decoded)) {
    throw new Error('Execution artifact export payload is not a valid current exact artifact.');
  }
  if (!(await executionArtifactIntegrityIsValid(decoded))) {
    throw new Error('Execution artifact export payload failed its provenance integrity check.');
  }
  return decoded;
}

export async function computeExecutionArtifactExportEnvelopeSha256(
  body: ExecutionArtifactExportBodyV1,
): Promise<`sha256:${string}`> {
  return sha256Utf8(`${EXPORT_ENVELOPE_DOMAIN}${canonicalJson(body)}`);
}

function encodeValue(
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set<object>(),
): EncodedJson {
  assertDepth(depth);
  if (value instanceof ArrayBuffer) return encodeBinary('ArrayBuffer', value, value.byteLength);
  if (ArrayBuffer.isView(value)) return encodeView(value);
  if (typeof value === 'object' && value !== null) {
    return encodeReference(value, depth, ancestors);
  }
  return encodePrimitive(value);
}

function encodePrimitive(value: unknown): EncodedJson {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'number') {
    throw new Error('Execution artifact contains a non-finite number.');
  }
  throw new Error('Execution artifact contains a value that JSON cannot preserve.');
}

function encodeReference(value: object, depth: number, ancestors: Set<object>): EncodedJson {
  if (ancestors.has(value)) throw new Error('Execution artifact contains a cycle.');
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? encodeArray(value, depth, ancestors)
      : encodePlainObject(value, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function encodeArray(
  value: ReadonlyArray<unknown>,
  depth: number,
  ancestors: Set<object>,
): ReadonlyArray<EncodedJson> {
  const encoded: EncodedJson[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new Error('Execution artifact contains a sparse array.');
    }
    encoded.push(encodeValue(value[index], depth + 1, ancestors));
  }
  return encoded;
}

function encodePlainObject(
  value: object,
  depth: number,
  ancestors: Set<object>,
): Readonly<Record<string, EncodedJson>> {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Execution artifact contains a non-plain object.');
  }
  const source = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(source, BINARY_TAG)) {
    throw new Error(`Execution artifact uses reserved export key ${BINARY_TAG}.`);
  }
  const encoded: Record<string, EncodedJson> = {};
  for (const key of Object.keys(source)) {
    const item = source[key];
    if (item === undefined) continue;
    encoded[key] = encodeValue(item, depth + 1, ancestors);
  }
  return encoded;
}

function encodeView(value: ArrayBufferView): EncodedBinary {
  const type = binaryType(value);
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const elementLength = 'length' in value ? Number(value.length) : value.byteLength;
  return encodeBinary(type, bytes, elementLength);
}

function encodeBinary(
  type: BinaryType,
  value: ArrayBuffer | Uint8Array,
  elementLength: number,
): EncodedBinary {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return {
    [BINARY_TAG]: {
      type,
      byteLength: bytes.byteLength,
      elementLength,
      base64: bytesToBase64(bytes),
    },
  };
}

function binaryType(value: ArrayBufferView): BinaryType {
  const name = value instanceof DataView ? 'DataView' : value.constructor.name;
  if (isBinaryType(name) && name !== 'ArrayBuffer') return name;
  throw new Error(`Unsupported execution artifact binary type: ${name}.`);
}

function decodeValue(value: unknown, depth = 0): unknown {
  assertDepth(depth);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Export contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, depth + 1));
  if (!isRecord(value)) throw new Error('Export contains an unsupported value.');
  if (Object.prototype.hasOwnProperty.call(value, BINARY_TAG)) return decodeBinary(value);
  const decoded: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    decoded[key] = decodeValue(item, depth + 1);
  }
  return decoded;
}

function decodeBinary(value: Record<string, unknown>): ArrayBuffer | ArrayBufferView {
  if (Object.keys(value).length !== 1) throw new Error('Malformed binary export tag.');
  const tag = value[BINARY_TAG];
  if (!isRecord(tag)) throw new Error('Malformed binary export metadata.');
  const type = tag['type'];
  const byteLength = tag['byteLength'];
  const elementLength = tag['elementLength'];
  const base64 = tag['base64'];
  if (
    !isBinaryType(type) ||
    !isSafeNonNegativeInteger(byteLength) ||
    !isSafeNonNegativeInteger(elementLength) ||
    typeof base64 !== 'string'
  ) {
    throw new Error('Malformed binary export metadata.');
  }
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength !== byteLength) throw new Error('Binary export byte length does not match.');
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const decoded = constructBinary(type, buffer);
  const decodedLength =
    decoded instanceof ArrayBuffer
      ? decoded.byteLength
      : 'length' in decoded
        ? Number(decoded.length)
        : decoded.byteLength;
  if (decodedLength !== elementLength) {
    throw new Error('Binary export element length does not match.');
  }
  return decoded;
}

function constructBinary(type: BinaryType, buffer: ArrayBuffer): ArrayBuffer | ArrayBufferView {
  if (type === 'ArrayBuffer') return buffer;
  if (type === 'DataView') return new DataView(buffer);
  return TYPED_ARRAY_FACTORIES[type](buffer);
}

function canonicalJson(value: unknown, depth = 0): string {
  assertDepth(depth);
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (!isRecord(value)) throw new Error('Export envelope contains an unsupported value.');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`)
    .join(',')}}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Binary export contains invalid base64.');
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isBinaryType(value: unknown): value is BinaryType {
  return (
    typeof value === 'string' &&
    [
      'ArrayBuffer',
      'DataView',
      'Int8Array',
      'Uint8Array',
      'Uint8ClampedArray',
      'Int16Array',
      'Uint16Array',
      'Int32Array',
      'Uint32Array',
      'Float32Array',
      'Float64Array',
      'BigInt64Array',
      'BigUint64Array',
    ].includes(value)
  );
}

function assertDepth(depth: number): void {
  if (depth > MAX_CODEC_DEPTH) throw new Error('Execution artifact export is nested too deeply.');
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
