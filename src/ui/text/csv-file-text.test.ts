import { describe, expect, it } from 'vitest';
import { csvImportNotice, decodeCsvBytes } from './csv-file-text';

describe('decodeCsvBytes', () => {
  it('reads UTF-8 and drops its byte order mark', () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('name\nJ\u00f6rg\n'),
    ]);

    expect(decodeCsvBytes(bytes)).toEqual({ text: 'name\nJ\u00f6rg\n', encoding: 'utf-8' });
  });

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    // "Jörg €5" in Excel's Western code page: 0xF6 is ö and 0x80 is the euro sign.
    const bytes = new Uint8Array([0x4a, 0xf6, 0x72, 0x67, 0x20, 0x80, 0x35]);

    expect(decodeCsvBytes(bytes)).toEqual({ text: 'J\u00f6rg \u20ac5', encoding: 'windows-1252' });
  });

  it('reads a UTF-16 file by its byte order mark', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x4a, 0x00, 0xf6, 0x00]);

    expect(decodeCsvBytes(bytes)).toEqual({ text: 'J\u00f6', encoding: 'utf-16le' });
  });
});

describe('csvImportNotice', () => {
  it('keeps the plain success message for a UTF-8 comma file', () => {
    expect(csvImportNotice(3, 'utf-8', ',')).toEqual({
      message: 'Embedded 3 CSV record(s).',
      variant: 'success',
    });
  });

  it('warns that a guessed Windows-1252 file should be checked', () => {
    const notice = csvImportNotice(2, 'windows-1252', ';');

    expect(notice.variant).toBe('warning');
    expect(notice.message).toContain('Columns are separated by semicolons.');
    expect(notice.message).toContain('read as Windows-1252');
    expect(notice.message).toContain('"CSV UTF-8"');
  });
});
