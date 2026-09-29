// Excel's classic "CSV (Comma delimited)" format writes the Windows ANSI code
// page (Windows-1252 on Western-locale PCs), not UTF-8. File.text() decodes
// every file as UTF-8 and silently turns each accented letter into U+FFFD, so
// the importer decodes strictly as UTF-8 first and falls back to Windows-1252
// only when the bytes cannot be UTF-8, then says so in its message.

import type { CsvDelimiter } from '../../core/variables/parse-csv';
import type { ToastVariant } from '../state/toast-store';

export type CsvTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export type DecodedCsvText = {
  readonly text: string;
  readonly encoding: CsvTextEncoding;
};

export function decodeCsvBytes(bytes: Uint8Array): DecodedCsvText {
  // A UTF-16 byte order mark is not valid UTF-8, so without this check a
  // "Unicode Text" export would be misread as Windows-1252.
  const utf16 = utf16ByteOrderMark(bytes);
  if (utf16 !== null) return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16 };
  try {
    // fatal: invalid bytes throw instead of becoming U+FFFD. The decoder
    // drops a leading UTF-8 byte order mark.
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

function utf16ByteOrderMark(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

export type CsvImportNotice = {
  readonly message: string;
  readonly variant: ToastVariant;
};

/** The import toast: the record count, plus how the file was read when that was a guess. */
export function csvImportNotice(
  recordCount: number,
  encoding: CsvTextEncoding,
  delimiter: CsvDelimiter,
): CsvImportNotice {
  const parts = [`Embedded ${recordCount} CSV record(s).`];
  if (delimiter === ';') parts.push('Columns are separated by semicolons.');
  if (delimiter === '\t') parts.push('Columns are separated by tabs.');
  if (encoding !== 'windows-1252') return { message: parts.join(' '), variant: 'success' };
  parts.push(
    'The file is not UTF-8, so it was read as Windows-1252 (Excel "CSV (Comma delimited)").' +
      ' If names look wrong, save it from Excel as "CSV UTF-8" and import it again.',
  );
  // A guessed encoding asks the operator to check the names, so it stays up
  // as long as other advisories instead of leaving like a plain success.
  return { message: parts.join(' '), variant: 'warning' };
}
