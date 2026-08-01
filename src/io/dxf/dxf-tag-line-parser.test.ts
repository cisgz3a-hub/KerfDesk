import { describe, expect, it } from 'vitest';
import { iterateLines } from '../../core/util';
import { createDxfTagLineParser } from './dxf-tag-line-parser';
import { tokenizeDxf } from './dxf-tags';

describe('createDxfTagLineParser', () => {
  it.each([
    '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n',
    '0\r\nSECTION\r\n0\r\nEOF\r\n',
    '0\nSECTION\n\nnotacode\n',
    '0\nSECTION',
    'AutoCAD Binary DXF\x00',
    '',
  ])('matches the compatibility tokenizer for %j', (text) => {
    const tags: { code: number; value: string }[] = [];
    const parser = createDxfTagLineParser((tag) => tags.push(tag));
    for (const line of iterateLines(text)) parser.pushLine(line);
    const result = parser.finish();

    const expected = tokenizeDxf(text);
    expect(result).toEqual(expected.kind === 'error' ? expected : { kind: 'ok' });
    if (expected.kind === 'ok') expect(tags).toEqual(expected.tags);
  });
});
