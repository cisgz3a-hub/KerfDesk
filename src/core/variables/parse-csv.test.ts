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
      delimiter: ',',
    });
  });

  it('preserves empty fields and an empty final field', () => {
    const result = parseVariableCsv('values.csv', 'a,b,c\n1,,\n');

    expect(result.ok && result.dataset.records).toEqual([['1', '', '']]);
  });

  it('preserves canonically equivalent headers and records as distinct raw identities', () => {
    const result = parseVariableCsv(
      'canonical.csv',
      'Caf\u00e9,Cafe\u0301\nCaf\u00e9,Cafe\u0301\n',
    );

    expect(result).toEqual({
      ok: true,
      dataset: {
        sourceName: 'canonical.csv',
        headers: ['Caf\u00e9', 'Cafe\u0301'],
        records: [['Caf\u00e9', 'Cafe\u0301']],
      },
      delimiter: ',',
    });
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

describe('parseVariableCsv spreadsheet exports', () => {
  it('skips blank lines instead of making empty records or uneven rows', () => {
    expect(parseVariableCsv('names.csv', 'name\nAlice\nBob\n\n')).toMatchObject({
      ok: true,
      dataset: { records: [['Alice'], ['Bob']] },
    });
    expect(
      parseVariableCsv('names.csv', '\nname,number\r\nAlice,1\r\n\r\nBob,2\r\n'),
    ).toMatchObject({
      ok: true,
      dataset: {
        headers: ['name', 'number'],
        records: [
          ['Alice', '1'],
          ['Bob', '2'],
        ],
      },
    });
  });

  it('keeps an explicitly quoted empty value as a record', () => {
    expect(parseVariableCsv('names.csv', 'name\nAlice\n""\nBob')).toMatchObject({
      ok: true,
      dataset: { records: [['Alice'], [''], ['Bob']] },
    });
  });

  it('numbers error rows as the spreadsheet shows them, blank lines included', () => {
    expect(parseVariableCsv('bad.csv', 'a,b\n\n1\n')).toMatchObject({
      ok: false,
      row: 3,
      message: 'CSV row 3 has 1 fields; expected 2.',
    });
  });

  it('reads semicolon- and tab-separated exports by their header row', () => {
    expect(parseVariableCsv('eu.csv', '"last, first";number\n"Doe; Jane";1,5\n')).toMatchObject({
      ok: true,
      dataset: { headers: ['last, first', 'number'], records: [['Doe; Jane', '1,5']] },
      delimiter: ';',
    });
    expect(parseVariableCsv('tabs.csv', 'name\tnumber\nAlice\t1\n')).toMatchObject({
      ok: true,
      dataset: { headers: ['name', 'number'], records: [['Alice', '1']] },
      delimiter: '\t',
    });
  });

  it('keeps commas as the separator when the header row has one or has no separator', () => {
    expect(parseVariableCsv('names.csv', 'name,note\nAlice,a;b\n')).toMatchObject({
      ok: true,
      dataset: { records: [['Alice', 'a;b']] },
      delimiter: ',',
    });
    expect(parseVariableCsv('names.csv', 'name\nAl;ice\n')).toMatchObject({
      ok: true,
      dataset: { records: [['Al;ice']] },
      delimiter: ',',
    });
  });

  it('stores a line break inside a quoted cell as LF only', () => {
    expect(parseVariableCsv('names.csv', 'name\r\n"Anna\r\nBen"\r\n"C\rD"\r\n')).toMatchObject({
      ok: true,
      dataset: { records: [['Anna\nBen'], ['C\nD']] },
    });
  });
});
