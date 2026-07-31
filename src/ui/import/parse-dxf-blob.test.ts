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
});
