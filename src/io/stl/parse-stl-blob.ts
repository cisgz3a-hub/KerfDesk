import { FLOATS_PER_TRIANGLE } from '../../core/relief';
import { readBlobLines, type BlobReadProgress } from '../blob-line-reader';
import { BINARY_STL_HEADER_BYTES, BINARY_STL_RECORD_BYTES } from './parse-stl-binary';
import type { ParseStlResult } from './parse-stl';

const COUNT_BYTES = 4;
const BINARY_PREFIX_BYTES = BINARY_STL_HEADER_BYTES + COUNT_BYTES;
const ASCII_SNIFF_BYTES = 512;
const VERTICES_PER_FACET = 3;

export async function parseStlBlob(
  blob: Blob,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<ParseStlResult> {
  const prefix = await blob
    .slice(0, Math.max(BINARY_PREFIX_BYTES, ASCII_SNIFF_BYTES))
    .arrayBuffer();
  const headerCount = binaryTriangleCount(prefix);
  if (headerCount !== null && blob.size === binaryExpectedBytes(headerCount)) {
    return parseBinaryBlob(blob, headerCount, onProgress);
  }

  const head = new TextDecoder().decode(prefix).trimStart().toLowerCase();
  if (head.startsWith('solid')) {
    const ascii = await parseAsciiBlob(blob, onProgress);
    if (ascii !== null) return ascii;
  }
  if (blob.size >= BINARY_STL_HEADER_BYTES) {
    if (headerCount === null)
      return { kind: 'error', reason: 'File too small to be a binary STL.' };
    return binarySizeError(blob.size, headerCount);
  }
  return {
    kind: 'error',
    reason: 'Not a recognizable STL: neither the binary length signature nor ASCII "solid" found.',
  };
}

async function parseBinaryBlob(
  blob: Blob,
  triangleCount: number,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<ParseStlResult> {
  const positions = new Float32Array(triangleCount * FLOATS_PER_TRIANGLE);
  const record = new Uint8Array(BINARY_STL_RECORD_BYTES);
  let recordBytes = 0;
  let triangle = 0;
  let bytesRead = BINARY_PREFIX_BYTES;
  onProgress?.({ bytesRead, totalBytes: blob.size });
  for await (const chunk of blobChunks(blob.slice(BINARY_PREFIX_BYTES))) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const take = Math.min(BINARY_STL_RECORD_BYTES - recordBytes, chunk.byteLength - offset);
      record.set(chunk.subarray(offset, offset + take), recordBytes);
      recordBytes += take;
      offset += take;
      if (recordBytes === BINARY_STL_RECORD_BYTES) {
        writeBinaryTriangle(record, positions, triangle);
        triangle += 1;
        recordBytes = 0;
      }
    }
    bytesRead += chunk.byteLength;
    onProgress?.({ bytesRead, totalBytes: blob.size });
  }
  return { kind: 'ok', mesh: { positions }, format: 'binary' };
}

function writeBinaryTriangle(record: Uint8Array, positions: Float32Array, triangle: number): void {
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const outputBase = triangle * FLOATS_PER_TRIANGLE;
  for (let value = 0; value < FLOATS_PER_TRIANGLE; value += 1) {
    positions[outputBase + value] = view.getFloat32(12 + value * 4, true);
  }
}

async function parseAsciiBlob(
  blob: Blob,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<ParseStlResult | null> {
  const countPass = createAsciiTokenPass();
  await readBlobLines(blob, countPass.pushLine, ({ bytesRead }) => {
    onProgress?.({ bytesRead, totalBytes: blob.size * 2 });
  });
  const counted = countPass.finish();
  if (!counted.sawFacet) return null;
  if (counted.error !== null) return { kind: 'error', reason: counted.error };
  const positions = new Float32Array(counted.vertexCount * 3);
  const fillPass = createAsciiTokenPass(positions);
  await readBlobLines(blob, fillPass.pushLine, ({ bytesRead }) => {
    onProgress?.({ bytesRead: blob.size + bytesRead, totalBytes: blob.size * 2 });
  });
  const filled = fillPass.finish();
  if (filled.error !== null) return { kind: 'error', reason: filled.error };
  return { kind: 'ok', mesh: { positions }, format: 'ascii' };
}

type AsciiPassOutcome = {
  readonly error: string | null;
  readonly sawFacet: boolean;
  readonly vertexCount: number;
};

function createAsciiTokenPass(output?: Float32Array): {
  readonly pushLine: (line: string) => void;
  readonly finish: () => AsciiPassOutcome;
} {
  let tokenIndex = 0;
  let vertexToken: number | null = null;
  let coordinateTokens: string[] = [];
  let vertexCount = 0;
  let sawFacet = false;
  let error: string | null = null;

  const pushToken = (token: string): void => {
    if (error !== null) return;
    if (vertexToken !== null) {
      coordinateTokens.push(token);
      if (coordinateTokens.length === 3) {
        const values = coordinateTokens.map((value) => Number.parseFloat(value));
        if (values.some((value) => !Number.isFinite(value))) {
          error = `Non-numeric vertex near token ${vertexToken}.`;
        } else if (output !== undefined) {
          const at = vertexCount * 3;
          output[at] = values[0] as number;
          output[at + 1] = values[1] as number;
          output[at + 2] = values[2] as number;
        }
        vertexCount += 1;
        vertexToken = null;
        coordinateTokens = [];
      }
      tokenIndex += 1;
      return;
    }
    if (token.toLowerCase() === 'vertex') vertexToken = tokenIndex;
    tokenIndex += 1;
  };

  const pushLine = (line: string): void => {
    if (line.toLowerCase().includes('facet')) sawFacet = true;
    for (const token of line.split(/\s+/)) {
      if (token.length > 0) pushToken(token);
    }
  };
  const finish = (): AsciiPassOutcome => {
    if (error === null && vertexToken !== null) {
      error = `Non-numeric vertex near token ${vertexToken}.`;
    }
    if (error === null && vertexCount === 0) error = 'ASCII STL contains no vertices.';
    if (error === null && vertexCount % VERTICES_PER_FACET !== 0) {
      error = `ASCII STL has a partial facet: ${vertexCount} vertices is not a multiple of 3.`;
    }
    return { error, sawFacet, vertexCount };
  };
  return { pushLine, finish };
}

function binaryTriangleCount(prefix: ArrayBuffer): number | null {
  if (prefix.byteLength < BINARY_PREFIX_BYTES) return null;
  return new DataView(prefix).getUint32(BINARY_STL_HEADER_BYTES, true);
}

function binaryExpectedBytes(triangleCount: number): number {
  return BINARY_PREFIX_BYTES + triangleCount * BINARY_STL_RECORD_BYTES;
}

function binarySizeError(fileBytes: number, triangleCount: number): ParseStlResult {
  const expected = binaryExpectedBytes(triangleCount);
  return {
    kind: 'error',
    reason:
      `Binary STL is truncated or padded: ${triangleCount} triangles need ${expected} bytes, ` +
      `file has ${fileBytes}.`,
  };
}

async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const entry = await reader.read();
      if (entry.done) return;
      yield entry.value;
    }
  } finally {
    reader.releaseLock();
  }
}
