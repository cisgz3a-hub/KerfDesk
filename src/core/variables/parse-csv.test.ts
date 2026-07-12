import { describe, expect, it } from 'vitest';
import { parseVariableCsv } from './parse-csv';

describe('parseVariableCsv', () => {
  it('parses RFC 4180 commas, escaped quotes, CRLF, and quoted newlines', () => {
    const result = parseVariableCsv(
      'people.csv',
      '\uFEFFname,note,city\r\n"Doe, Jane","said ""hello""","New\nYork"\r\n',
    );

    expect(result).toEqual({
      ok: true,
      dataset: {
        sourceName: 'people.csv',
        headers: ['name', 'note', 'city'],
        records: [['Doe, Jane', 'said "hello"', 'New\nYork']],
      },
    });
  });

  it('preserves empty fields and an empty final field', () => {
    const result = parseVariableCsv('values.csv', 'a,b,c\n1,,\n');

    expect(result.ok && result.dataset.records).toEqual([['1', '', '']]);
  });

  it('rejects unterminated quotes, duplicate headers, and uneven rows', () => {
    expect(parseVariableCsv('bad.csv', 'a\n"open')).toMatchObject({ ok: false, row: 2 });
    expect(parseVariableCsv('bad.csv', 'a,a\n1,2')).toMatchObject({
      ok: false,
      message: expect.stringContaining('duplicated'),
    });
    expect(parseVariableCsv('bad.csv', 'a,b\n1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('expected 2'),
    });
    expect(parseVariableCsv('bad.csv', 'a\n"closed"junk')).toMatchObject({
      ok: false,
      message: expect.stringContaining('closing quote'),
    });
  });
});
