import { describe, expect, it } from 'vitest';
import { readUtf8ChunkLines } from './blob-line-reader';

async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.slice(offset, offset + size);
  }
}

describe('readUtf8ChunkLines', () => {
  it('assembles one long logical line from many chunks without rescanning prior chunks', async () => {
    const text = 'G1 X'.padEnd(2 * 1024 * 1024, '7');
    const bytes = new TextEncoder().encode(text);
    const lines: string[] = [];

    const stats = await readUtf8ChunkLines(chunks(bytes, 4096), (line) => lines.push(line));

    expect(lines).toEqual([text]);
    expect(stats.lineCount).toBe(1);
    expect(stats.maxBufferedChars).toBe(text.length);
  });
});
