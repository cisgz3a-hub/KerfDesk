import type { VariableCsvDataset } from '../scene';

type CsvError = {
  readonly ok: false;
  readonly message: string;
  readonly row: number;
  readonly column: number;
};
export type CsvDelimiter = ',' | ';' | '\t';
export type CsvParseResult =
  | { readonly ok: true; readonly dataset: VariableCsvDataset; readonly delimiter: CsvDelimiter }
  | CsvError;

const MAX_CSV_CHARACTERS = 10_000_000;
const MAX_CSV_ROWS = 100_000;
const MAX_CSV_COLUMNS = 1_000;

// Rows are numbered as a spreadsheet shows them: blank lines count, so an
// error names the row the operator sees even though blank lines are skipped.
export function parseVariableCsv(sourceName: string, source: string): CsvParseResult {
  if (source.length > MAX_CSV_CHARACTERS) return csvError('CSV exceeds the 10 MB limit.', 1, 1);
  const text = source.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const parsed = parseRows(text, delimiter);
  if (!parsed.ok) return parsed;
  if (parsed.rows.length === 0) return csvError('CSV needs a header row.', 1, 1);
  const headers = parsed.rows[0] ?? [];
  const invalid =
    headerError(headers, parsed.rowNumbers[0] ?? 1) ?? unevenRowError(parsed, headers.length);
  if (invalid !== null) return invalid;
  return { ok: true, dataset: { sourceName, headers, records: parsed.rows.slice(1) }, delimiter };
}

function headerError(headers: readonly string[], row: number): CsvError | null {
  if (headers.length === 0 || headers.some((header) => header === '')) {
    return csvError('Every CSV column needs a name.', row, 1);
  }
  const duplicate = firstDuplicate(headers);
  if (duplicate !== null) return csvError(`CSV header "${duplicate}" is duplicated.`, row, 1);
  if (headers.length > MAX_CSV_COLUMNS) return csvError('CSV has too many columns.', row, 1);
  return null;
}

function unevenRowError(parsed: CsvRows, width: number): CsvError | null {
  const uneven = parsed.rows.findIndex((record, index) => index > 0 && record.length !== width);
  if (uneven < 0) return null;
  const row = parsed.rowNumbers[uneven] ?? uneven + 1;
  const fields = parsed.rows[uneven]?.length ?? 0;
  return csvError(`CSV row ${row} has ${fields} fields; expected ${width}.`, row, 1);
}

/**
 * Excel writes semicolons where the decimal separator is a comma, and its
 * "Text (Tab delimited)" format uses tabs. A header row with a comma is
 * comma-separated; without one, a tab or semicolon names the separator.
 */
function detectDelimiter(source: string): CsvDelimiter {
  const seen = headerSeparators(source);
  if (seen.has(',')) return ',';
  if (seen.has('\t')) return '\t';
  return seen.has(';') ? ';' : ',';
}

function headerSeparators(source: string): ReadonlySet<string> {
  const seen = new Set<string>();
  let quoted = false;
  let started = false;
  for (const character of source) {
    if (!quoted && isNewline(character)) {
      if (started) break;
      continue;
    }
    started = true;
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === ',' || character === ';' || character === '\t')) {
      seen.add(character);
    }
  }
  return seen;
}

type CsvRows = {
  readonly ok: true;
  readonly rows: readonly (readonly string[])[];
  readonly rowNumbers: readonly number[];
};
type ParsedRows = CsvRows | CsvError;
type CsvMode = 'unquoted' | 'quoted' | 'after-quote';
type CsvCursor = {
  readonly rows: string[][];
  readonly rowNumbers: number[];
  readonly delimiter: CsvDelimiter;
  row: string[];
  field: string;
  index: number;
  mode: CsvMode;
  rowNumber: number;
};

function parseRows(source: string, delimiter: CsvDelimiter): ParsedRows {
  const cursor: CsvCursor = {
    rows: [],
    rowNumbers: [],
    delimiter,
    row: [],
    field: '',
    index: 0,
    mode: 'unquoted',
    rowNumber: 1,
  };
  while (cursor.index < source.length) {
    const error = consumeCharacter(cursor, source);
    if (error !== null) return error;
    if (cursor.rows.length > MAX_CSV_ROWS) {
      return csvError('CSV has too many rows.', cursor.rows.length, 1);
    }
    if (cursor.row.length > MAX_CSV_COLUMNS) {
      return csvError('CSV has too many columns.', rowNo(cursor), cursor.row.length);
    }
  }
  if (cursor.mode === 'quoted') {
    return csvError('CSV ends inside a quoted field.', rowNo(cursor), columnNo(cursor));
  }
  if (cursor.field !== '' || cursor.row.length > 0 || cursor.mode === 'after-quote') {
    cursor.rows.push([...cursor.row, cursor.field]);
    cursor.rowNumbers.push(cursor.rowNumber);
  }
  return { ok: true, rows: cursor.rows, rowNumbers: cursor.rowNumbers };
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
  } else if (character === '\r') {
    // A line break inside a cell keeps only its LF: a CR from a CRLF file
    // would reach the text renderer as a character no font draws.
    cursor.field += '\n';
    cursor.index += source[cursor.index + 1] === '\n' ? 2 : 1;
  } else {
    if (character === '"') cursor.mode = 'after-quote';
    else cursor.field += character;
    cursor.index += 1;
  }
  return null;
}

function consumeAfterQuote(cursor: CsvCursor, source: string): CsvError | null {
  const character = source[cursor.index] ?? '';
  if (character === cursor.delimiter) finishField(cursor);
  else if (isNewline(character)) finishRow(cursor, source);
  else {
    return csvError(
      `A closing quote must be followed by ${delimiterName(cursor.delimiter)} or newline.`,
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
  } else if (character === cursor.delimiter) finishField(cursor);
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
  // A line with nothing on it, not even a quoted empty field, is not a
  // record: a trailing blank line would otherwise become an empty tag, and a
  // blank line in a wider file would reject the import as an uneven row.
  const blank = cursor.row.length === 0 && cursor.field === '' && cursor.mode === 'unquoted';
  if (!blank) {
    cursor.rows.push([...cursor.row, cursor.field]);
    cursor.rowNumbers.push(cursor.rowNumber);
  }
  cursor.rowNumber += 1;
  cursor.row = [];
  cursor.field = '';
  cursor.mode = 'unquoted';
  cursor.index += source[cursor.index] === '\r' && source[cursor.index + 1] === '\n' ? 2 : 1;
}

function isNewline(character: string): boolean {
  return character === '\r' || character === '\n';
}

function delimiterName(delimiter: CsvDelimiter): string {
  if (delimiter === ';') return 'a semicolon';
  if (delimiter === '\t') return 'a tab';
  return 'a comma';
}

function rowNo(cursor: CsvCursor): number {
  return cursor.rowNumber;
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
