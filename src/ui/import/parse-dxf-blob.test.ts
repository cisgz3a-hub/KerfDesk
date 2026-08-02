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
    // Only the entity pass, which always reads to EOF, is visible progress, so
    // the denominator is one file rather than two passes.
    expect(progress).toHaveBeenLastCalledWith({
      bytesRead: text.length,
      totalBytes: text.length,
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

  // The metadata pass abandons the file at the ENTITIES header, so counting it
  // in the denominator left the bar crawling near 0% and then snapping to ~50%
  // the moment the entity pass started — on virtually every normal DXF.
  it('advances progress in small steps instead of jumping when the entity pass starts', async () => {
    const text = conformantDxf(ENTITY_COUNT);
    const fractions: number[] = [];

    await parseDxfBlob(
      lineChunkedBlob(text, { chunks: 0 }),
      { id: 'progress', source: 'progress.dxf' },
      ({ bytesRead, totalBytes }) => {
        fractions.push(bytesRead / totalBytes);
      },
    );

    expect(fractions.length).toBeGreaterThan(0);
    expect(Math.max(...progressSteps(fractions))).toBeLessThan(MAX_PROGRESS_STEP);
    expect(Math.min(...progressSteps(fractions))).toBeGreaterThanOrEqual(0);
    expect(fractions.at(-1)).toBe(1);
  });
});

const ENTITY_COUNT = 40;
// A jump this large can only come from a pass boundary: one chunk of this
// fixture is a single short DXF line, well under a percent of the file.
const MAX_PROGRESS_STEP = 0.25;

// Rises from the implicit 0% the bar starts at, so a first report that already
// sits at half the file counts as a jump too.
function progressSteps(fractions: ReadonlyArray<number>): ReadonlyArray<number> {
  let previous = 0;
  return fractions.map((fraction) => {
    const step = fraction - previous;
    previous = fraction;
    return step;
  });
}
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
