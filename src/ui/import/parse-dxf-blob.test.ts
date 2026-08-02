import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { parseDxf } from '../../io/dxf';
import { parseDxfBlob } from './parse-dxf-blob';

describe('parseDxfBlob', () => {
  it('streams both semantic passes and matches the compatibility parser', async () => {
    const text = [
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$INSUNITS',
      '70',
      '1',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'LINE',
      '10',
      '0',
      '20',
      '0',
      '11',
      '2',
      '21',
      '0',
      '0',
      'ENDSEC',
      '0',
      'EOF',
      '',
    ].join('\r\n');
    const progress = vi.fn();
    const args = { id: 'streamed', source: 'streamed.dxf' };

    const result = await parseDxfBlob(new NodeBlob([text]) as unknown as Blob, args, progress);

    expect(result).toEqual(parseDxf({ dxfText: text, ...args }));
    expect(progress).toHaveBeenLastCalledWith({
      bytesRead: text.length * 2,
      totalBytes: text.length * 2,
    });
  });

  it('resolves blocks in the metadata pass even when ENTITIES appears first', async () => {
    const text = [
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'INSERT',
      '2',
      'LATE',
      '10',
      '5',
      '20',
      '0',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'BLOCKS',
      '0',
      'BLOCK',
      '2',
      'LATE',
      '10',
      '0',
      '20',
      '0',
      '0',
      'LINE',
      '10',
      '0',
      '20',
      '0',
      '11',
      '2',
      '21',
      '0',
      '0',
      'ENDBLK',
      '0',
      'ENDSEC',
      '0',
      'EOF',
    ].join('\n');

    const result = await parseDxfBlob(new NodeBlob([text]) as unknown as Blob, {
      id: 'late-block',
      source: 'late-block.dxf',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.pathCount).toBe(1);
      expect(result.notes).toEqual([]);
    }
  });

  it('stops the metadata pass at the ENTITIES section instead of tokenizing it twice', async () => {
    const text = conformantDxf(ENTITY_COUNT);
    const lineCount = text.split('\n').length;
    const reads = { chunks: 0 };

    const result = await parseDxfBlob(lineChunkedBlob(text, reads), {
      id: 'early-stop',
      source: 'early-stop.dxf',
    });

    // Pass 2 always reads the whole file; pass 1 must give up at the ENTITIES
    // header, so the two passes together cost barely more than one full read
    // instead of the two the metadata pass used to force.
    expect(reads.chunks).toBeLessThan(lineCount + PRE_ENTITIES_LINE_BUDGET);
    expect(result).toEqual(parseDxf({ dxfText: text, id: 'early-stop', source: 'early-stop.dxf' }));
  });
});

const ENTITY_COUNT = 40;
// Header lines before ENTITIES, plus slack for the stream's read-ahead.
const PRE_ENTITIES_LINE_BUDGET = 32;

function conformantDxf(entities: number): string {
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'];
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (let index = 0; index < entities; index += 1) {
    lines.push('0', 'LINE', '10', '0', '20', `${index}`, '11', '2', '21', `${index}`);
  }
  lines.push('0', 'ENDSEC', '0', 'EOF', '');
  return lines.join('\n');
}

function lineChunkedBlob(text: string, reads: { chunks: number }): Blob {
  const encoder = new TextEncoder();
  const parts = text
    .split('\n')
    .map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line));
  // The reader touches only size and stream; this double deliberately omits
  // unrelated Blob methods so delivered chunks can be counted.
  return {
    size: encoder.encode(text).byteLength,
    stream: () => {
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index >= parts.length) {
            controller.close();
            return;
          }
          reads.chunks += 1;
          controller.enqueue(encoder.encode(parts[index] ?? ''));
          index += 1;
        },
      });
    },
  } as Blob;
}
