import { describe, expect, it, vi } from 'vitest';
import {
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import { deserializeMaterialLibraryValue } from '../../io/material-library/stream';
import { parseDocumentImportSource } from './document-import-source';

describe('parseDocumentImportSource native material-library streaming', () => {
  it('uses Blob.stream without retaining a whole decoded source string', async () => {
    const libraryText = serializeMaterialLibrary(library());
    const text = vi.fn(async () => {
      throw new Error('whole Blob.text() is forbidden for production material-library parsing');
    });
    const stream = vi.fn(() => chunkedUtf8Stream(libraryText, [1, 17, 113]));
    const blob = { size: libraryText.length, text, stream } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource(
      { id: 51, kind: 'material-library', blob },
      onParsing,
    );

    expect(response).toEqual({
      id: 51,
      kind: 'material-library',
      result: deserializeMaterialLibrary(libraryText),
    });
    expect(text).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('returns the established invalid result for malformed streamed JSON', async () => {
    const malformed = '{"format":]';
    const text = vi.fn(async () => {
      throw new Error('malformed production input must not use Blob.text()');
    });
    const blob = {
      size: malformed.length,
      text,
      stream: () => chunkedUtf8Stream(malformed, [1, 7]),
    } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource(
      { id: 52, kind: 'material-library', blob },
      onParsing,
    );

    expect(response).toMatchObject({
      id: 52,
      kind: 'material-library',
      result: { kind: 'invalid', reason: expect.stringMatching(/^not valid JSON: /) },
    });
    expect(text).not.toHaveBeenCalled();
    expect(onParsing).not.toHaveBeenCalled();
  });

  it('propagates a partial stream failure without retrying through whole text', async () => {
    const text = vi.fn(async () => serializeMaterialLibrary(library()));
    let pull = 0;
    const blob = {
      size: 100,
      text,
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull === 0) {
              pull += 1;
              controller.enqueue(new TextEncoder().encode('{"format":'));
              return;
            }
            controller.error(new Error('fixture material stream failed after one chunk'));
          },
        }),
    } as unknown as Blob;
    const onParsing = vi.fn();

    await expect(
      parseDocumentImportSource({ id: 53, kind: 'material-library', blob }, onParsing),
    ).rejects.toThrow('fixture material stream failed after one chunk');
    expect(text).not.toHaveBeenCalled();
    expect(pull).toBe(1);
    expect(onParsing).not.toHaveBeenCalled();
  });

  it('preserves the whole-text compatibility path when Blob.stream is unavailable', async () => {
    const libraryText = serializeMaterialLibrary(library());
    const text = vi.fn(async () => libraryText);
    const blob = { size: libraryText.length, text, stream: undefined } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource(
      { id: 54, kind: 'material-library', blob },
      onParsing,
    );

    expect(response).toEqual({
      id: 54,
      kind: 'material-library',
      result: deserializeMaterialLibrary(libraryText),
    });
    expect(text).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('keeps material validation and normalization identical after streamed parsing', () => {
    const libraryText = serializeMaterialLibrary({
      ...library(),
      name: `before${String.fromCharCode(0xd800)}after`,
    });

    expect(deserializeMaterialLibraryValue(JSON.parse(libraryText))).toEqual(
      deserializeMaterialLibrary(libraryText),
    );
  });
});

function library(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'streamed-library',
    name: 'Streamed library',
    entries: [],
  };
}

function chunkedUtf8Stream(
  text: string,
  boundaries: ReadonlyArray<number>,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    const end = Math.min(boundary, bytes.byteLength);
    if (end > start) chunks.push(bytes.slice(start, end));
    start = end;
  }
  if (start < bytes.byteLength) chunks.push(bytes.slice(start));
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
}
