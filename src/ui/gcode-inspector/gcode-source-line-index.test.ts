import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  indexGcodeTextLines,
  indexUtf8ChunkLines,
  readGcodeSourceLines,
} from './gcode-source-line-index';

describe('G-code source line index', () => {
  it('indexes text code-unit offsets and lazily reads only the requested lines', async () => {
    const text = 'G21\r\n; caf\u00e9\n\rG1 X1\r\n';
    const parsedLines: string[] = [];
    const sourceIndex = indexGcodeTextLines(text, (line) => parsedLines.push(line));

    expect(parsedLines).toEqual(text.split(/\r\n|\n|\r/));
    expect(sourceIndex.unit).toBe('utf16-code-unit');
    await expect(readGcodeSourceLines({ kind: 'text', text }, sourceIndex, 1, 4)).resolves.toEqual(
      parsedLines.slice(1, 4),
    );
    await expect(readGcodeSourceLines({ kind: 'text', text }, sourceIndex, 4, 5)).resolves.toEqual([
      '',
    ]);
  });

  it('keeps UTF-8 offsets exact across CRLF and multibyte chunk boundaries', async () => {
    const text = '\u03b1\r\nG1 X1\n\n\u5c3e';
    const bytes = new TextEncoder().encode(text);
    const chunks = [bytes.slice(0, 1), bytes.slice(1, 3), bytes.slice(3, 12), bytes.slice(12)];
    const parsedLines: string[] = [];
    const progress = vi.fn();
    const sourceIndex = await indexUtf8ChunkLines(
      asAsync(chunks),
      bytes.byteLength,
      (line) => parsedLines.push(line),
      progress,
    );

    expect(parsedLines).toEqual(text.split(/\r\n|\n|\r/));
    expect(Array.from(sourceIndex.starts)).toEqual([0, 4, 10, 11]);
    expect(progress).toHaveBeenLastCalledWith({
      bytesRead: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });

    const blob = new NodeBlob([bytes]) as unknown as Blob;
    await expect(readGcodeSourceLines({ kind: 'blob', blob }, sourceIndex, 1, 3)).resolves.toEqual([
      'G1 X1',
      '',
    ]);
  });

  it('preserves an embedded UTF-8 BOM at the start of a non-first Blob line', async () => {
    const text = 'G0 X0\n\uFEFFG1 X1';
    const blob = new NodeBlob([text]) as unknown as Blob;
    const parsedLines: string[] = [];
    const sourceIndex = await indexUtf8ChunkLines(
      asAsync([new TextEncoder().encode(text)]),
      blob.size,
      (line) => parsedLines.push(line),
    );

    expect(parsedLines[1]).toBe('\uFEFFG1 X1');
    await expect(readGcodeSourceLines({ kind: 'blob', blob }, sourceIndex, 1, 2)).resolves.toEqual([
      '\uFEFFG1 X1',
    ]);
  });

  it('reports a source/index mismatch instead of showing wrong lines', async () => {
    const sourceIndex = indexGcodeTextLines('G0 X1', () => undefined);
    await expect(
      readGcodeSourceLines({ kind: 'text', text: 'G0 X12' }, sourceIndex, 0, 1),
    ).rejects.toThrow('does not match source');
  });
});

async function* asAsync(chunks: ReadonlyArray<Uint8Array>): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}
