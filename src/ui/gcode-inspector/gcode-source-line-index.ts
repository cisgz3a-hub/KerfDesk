import { iterateLines } from '../../core/util';
import type { BlobReadProgress } from '../import/blob-line-reader';
import type { GcodeInspectionSource } from './gcode-inspection-source';

export type GcodeSourceLineIndex = {
  readonly unit: 'utf8-byte' | 'utf16-code-unit';
  readonly starts: Float64Array;
  readonly sourceLength: number;
};

export function indexGcodeTextLines(
  text: string,
  onLine: (line: string) => void,
): GcodeSourceLineIndex {
  const starts = new SourceOffsetBuilder();
  starts.push(0);
  let lineStart = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char !== '\n' && char !== '\r') {
      index += 1;
      continue;
    }
    onLine(text.slice(lineStart, index));
    index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
    lineStart = index;
    starts.push(lineStart);
  }
  onLine(text.slice(lineStart));
  return { unit: 'utf16-code-unit', starts: starts.finish(), sourceLength: text.length };
}

export async function indexGcodeBlobLines(
  blob: Blob,
  onLine: (line: string) => void,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<GcodeSourceLineIndex> {
  return indexUtf8ChunkLines(blobChunks(blob), blob.size, onLine, onProgress);
}

export async function indexUtf8ChunkLines(
  chunks: AsyncIterable<Uint8Array>,
  totalBytes: number,
  onLine: (line: string) => void,
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<GcodeSourceLineIndex> {
  const decoder = new TextDecoder();
  const starts = new SourceOffsetBuilder();
  starts.push(0);
  let tail = '';
  let shouldSkipLeadingLf = false;
  let previousByteWasCr = false;
  let bytesRead = 0;

  const consumeText = (decoded: string): void => {
    if (decoded.length === 0) return;
    let text = decoded;
    if (shouldSkipLeadingLf) {
      if (text.startsWith('\n')) text = text.slice(1);
      shouldSkipLeadingLf = false;
    }
    const combined = tail + text;
    let lineStart = 0;
    let index = 0;
    while (index < combined.length) {
      const char = combined[index];
      if (char !== '\n' && char !== '\r') {
        index += 1;
        continue;
      }
      onLine(combined.slice(lineStart, index));
      if (char === '\r' && combined[index + 1] === '\n') index += 1;
      else if (char === '\r' && index + 1 === combined.length) shouldSkipLeadingLf = true;
      index += 1;
      lineStart = index;
    }
    tail = combined.slice(lineStart);
  };

  for await (const chunk of chunks) {
    for (let index = 0; index < chunk.byteLength; index += 1) {
      const byte = chunk[index];
      const afterByte = bytesRead + index + 1;
      if (byte === 0x0a) {
        if (previousByteWasCr) starts.replaceLast(afterByte);
        else starts.push(afterByte);
      } else if (byte === 0x0d) {
        starts.push(afterByte);
      }
      previousByteWasCr = byte === 0x0d;
    }
    bytesRead += chunk.byteLength;
    consumeText(decoder.decode(chunk, { stream: true }));
    onProgress?.({ bytesRead, totalBytes });
  }
  consumeText(decoder.decode());
  onLine(tail);
  return { unit: 'utf8-byte', starts: starts.finish(), sourceLength: bytesRead };
}

export async function readGcodeSourceLines(
  source: GcodeInspectionSource,
  sourceIndex: GcodeSourceLineIndex,
  first: number,
  last: number,
): Promise<ReadonlyArray<string>> {
  validateRange(source, sourceIndex, first, last);
  if (first === last) return [];
  const start = sourceIndex.starts[first] ?? 0;
  const end =
    last < sourceIndex.starts.length ? (sourceIndex.starts[last] ?? 0) : sourceIndex.sourceLength;
  const text =
    source.kind === 'text'
      ? source.text.slice(start, end)
      : decodeBlobWindow(await source.blob.slice(start, end).arrayBuffer(), start);
  const lines = Array.from(iterateLines(text));
  if (last < sourceIndex.starts.length) lines.pop();
  if (lines.length !== last - first) throw new Error('G-code source index does not match source.');
  return lines;
}

function decodeBlobWindow(bytes: ArrayBuffer, start: number): string {
  return new TextDecoder('utf-8', { ignoreBOM: start > 0 }).decode(bytes);
}

function validateRange(
  source: GcodeInspectionSource,
  sourceIndex: GcodeSourceLineIndex,
  first: number,
  last: number,
): void {
  const expectedUnit = source.kind === 'text' ? 'utf16-code-unit' : 'utf8-byte';
  const sourceLength = source.kind === 'text' ? source.text.length : source.blob.size;
  if (sourceIndex.unit !== expectedUnit || sourceIndex.sourceLength !== sourceLength) {
    throw new Error('G-code source index does not match source.');
  }
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(last) ||
    first < 0 ||
    last < first ||
    last > sourceIndex.starts.length
  ) {
    throw new Error('G-code source line range is invalid.');
  }
}

class SourceOffsetBuilder {
  private offsets = new Float64Array(1024);
  private length = 0;

  push(value: number): void {
    if (this.length === this.offsets.length) {
      const grown = new Float64Array(this.offsets.length * 2);
      grown.set(this.offsets);
      this.offsets = grown;
    }
    this.offsets[this.length] = value;
    this.length += 1;
  }

  replaceLast(value: number): void {
    if (this.length === 0) throw new Error('Cannot replace an empty source offset index.');
    this.offsets[this.length - 1] = value;
  }

  finish(): Float64Array {
    return this.offsets.slice(0, this.length);
  }
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
