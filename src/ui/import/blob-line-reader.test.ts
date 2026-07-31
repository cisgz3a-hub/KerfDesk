import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { iterateLines } from '../../core/util';
import { readBlobLines, readUtf8ChunkLines } from './blob-line-reader';

async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.slice(offset, offset + size);
  }
}

describe('incremental UTF-8 line reader', () => {
  it('matches the canonical line iterator across byte, UTF-8, and CRLF boundaries', async () => {
    const text = 'G1 X1\r\n; café\rG1 X2\n\nM2\r\n';
    const bytes = new TextEncoder().encode(text);
    const actual: string[] = [];

    const stats = await readUtf8ChunkLines(chunks(bytes, 3), (line) => actual.push(line));

    expect(actual).toEqual([...iterateLines(text)]);
    expect(stats.bytesRead).toBe(bytes.byteLength);
    expect(stats.lineCount).toBe(actual.length);
    expect(stats.maxBufferedChars).toBeLessThan(text.length);
  });

  it('retains only the current source chunk plus an unfinished logical line', async () => {
    const text = 'G1 X123456789\n'.repeat(10_000);
    const bytes = new TextEncoder().encode(text);

    const stats = await readUtf8ChunkLines(chunks(bytes, 64), () => undefined);

    expect(stats.lineCount).toBe(10_001);
    expect(stats.maxBufferedChars).toBeLessThanOrEqual(80);
  });

  it('reads a production Blob stream and reports byte progress', async () => {
    const progress = vi.fn();
    const lines: string[] = [];
    // jsdom's legacy Blob omits stream(); NodeBlob implements the same File API
    // method used by browsers and keeps this test on the production stream path.
    const blob = new NodeBlob(['G21\nG1 X1\n']) as unknown as Blob;

    const stats = await readBlobLines(blob, (line) => lines.push(line), progress);

    expect(lines).toEqual(['G21', 'G1 X1', '']);
    expect(stats.bytesRead).toBe(blob.size);
    expect(progress).toHaveBeenLastCalledWith({ bytesRead: blob.size, totalBytes: blob.size });
  });
});
