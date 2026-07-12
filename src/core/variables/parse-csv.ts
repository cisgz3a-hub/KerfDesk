import type { VariableCsvDataset } from '../scene';

type CsvError = {
  readonly ok: false;
  readonly message: string;
  readonly row: number;
  readonly column: number;
};
export type CsvParseResult = { readonly ok: true; readonly dataset: VariableCsvDataset } | CsvError;

const MAX_CSV_CHARACTERS = 10_000_000;
const MAX_CSV_ROWS = 100_000;
const MAX_CSV_COLUMNS = 1_000;

export function parseVariableCsv(sourceName: string, source: string): CsvParseResult {
  if (source.length > MAX_CSV_CHARACTERS) return csvError('CSV exceeds the 10 MB limit.', 1, 1);
  const parsed = parseRows(source.replace(/^\uFEFF/, ''));
  if (!parsed.ok) return parsed;
  if (parsed.rows.length === 0) return csvError('CSV needs a header row.', 1, 1);
  const headers = parsed.rows[0] ?? [];
  if (headers.length === 0 || headers.some((header) => header === '')) {
    return csvError('Every CSV column needs a name.', 1, 1);
  }
  const duplicate = firstDuplicate(headers);
  if (duplicate !== null) return csvError(`CSV header "${duplicate}" is duplicated.`, 1, 1);
  if (headers.length > MAX_CSV_COLUMNS) return csvError('CSV has too many columns.', 1, 1);
  const records = parsed.rows.slice(1);
  const uneven = records.findIndex((record) => record.length !== headers.length);
  if (uneven >= 0) {
    return csvError(
      `CSV row ${uneven + 2} has ${records[uneven]?.length ?? 0} fields; expected ${headers.length}.`,
      uneven + 2,
      1,
    );
  }
  return { ok: true, dataset: { sourceName, headers, records } };
}

type ParsedRows = { readonly ok: true; readonly rows: readonly (readonly string[])[] } | CsvError;
type CsvMode = 'unquoted' | 'quoted' | 'after-quote';
type CsvCursor = {
  readonly rows: string[][];
  row: string[];
  field: string;
  index: number;
  mode: CsvMode;
};

function parseRows(source: string): ParsedRows {
  const cursor: CsvCursor = { rows: [], row: [], field: '', index: 0, mode: 'unquoted' };
  while (cursor.index < source.length) {
    const error = consumeCharacter(cursor, source);
    if (error !== null) return error;
    if (cursor.rows.length > MAX_CSV_ROWS) {
      return csvError('CSV has too many rows.', cursor.rows.length, 1);
    }
    if (cursor.row.length > MAX_CSV_COLUMNS) {
      return csvError('CSV has too many columns.', cursor.rows.length + 1, cursor.row.length);
    }
  }
  if (cursor.mode === 'quoted') {
    return csvError(
      'CSV ends inside a quoted field.',
      cursor.rows.length + 1,
      cursor.row.length + 1,
    );
  }
  if (cursor.field !== '' || cursor.row.length > 0) cursor.rows.push([...cursor.row, cursor.field]);
  return { ok: true, rows: cursor.rows };
}

function consumeCharacter(cursor: CsvCursor, source: string): CsvError | null {
  if (cursor.mode === 'quoted') return consumeQuoted(cursor, source);
  if (cursor.mode === 'after-quote') return consumeAfterQuote(cursor, source);
  return consumeUnquoted(cursor, source);
}

function consumeQuoted(cursor: CsvCursor, source: string): null {
  const character = source[cursor.index] ?? '';
  if (character === '"' && source[cursor.index + 1] === '"') {
    cursor.field += '"';
    cursor.index += 2;
  } else {
    if (character === '"') cursor.mode = 'after-quote';
    else cursor.field += character;
    cursor.index += 1;
  }
  return null;
}

function consumeAfterQuote(cursor: CsvCursor, source: string): CsvError | null {
  const character = source[cursor.index] ?? '';
  if (character === ',') finishField(cursor);
  else if (isNewline(character)) finishRow(cursor, source);
  else {
    return csvError(
      'A closing quote must be followed by a comma or newline.',
      rowNo(cursor),
      columnNo(cursor),
    );
  }
  return null;
}

function consumeUnquoted(cursor: CsvCursor, source: string): CsvError | null {
  const character = source[cursor.index] ?? '';
  if (character === '"') {
    if (cursor.field !== '') {
      return csvError(
        'A quote cannot appear inside an unquoted field.',
        rowNo(cursor),
        columnNo(cursor),
      );
    }
    cursor.mode = 'quoted';
    cursor.index += 1;
  } else if (character === ',') finishField(cursor);
  else if (isNewline(character)) finishRow(cursor, source);
  else {
    cursor.field += character;
    cursor.index += 1;
  }
  return null;
}

function finishField(cursor: CsvCursor): void {
  cursor.row.push(cursor.field);
  cursor.field = '';
  cursor.mode = 'unquoted';
  cursor.index += 1;
}

function finishRow(cursor: CsvCursor, source: string): void {
  cursor.rows.push([...cursor.row, cursor.field]);
  cursor.row = [];
  cursor.field = '';
  cursor.mode = 'unquoted';
  cursor.index += source[cursor.index] === '\r' && source[cursor.index + 1] === '\n' ? 2 : 1;
}

function isNewline(character: string): boolean {
  return character === '\r' || character === '\n';
}

function rowNo(cursor: CsvCursor): number {
  return cursor.rows.length + 1;
}

function columnNo(cursor: CsvCursor): number {
  return cursor.row.length + 1;
}

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function csvError(message: string, row: number, column: number): CsvError {
  return { ok: false, message, row, column };
}
