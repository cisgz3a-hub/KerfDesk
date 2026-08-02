import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject, deserializeProjectValue, serializeProject } from '../../io/project';
import {
  parseDocumentImportSource,
  PROJECT_NATIVE_JSON_PARSE_MAX_BYTES,
} from './document-import-source';

describe('parseDocumentImportSource native-project streaming', () => {
  it('uses Blob.stream without retaining a whole decoded source string', async () => {
    const projectText = serializeProject({
      ...createProject(),
      notes: 'split UTF-8 snowman ☃ and supplementary 🧪',
    });
    const text = vi.fn(async () => {
      throw new Error('whole Blob.text() is forbidden for production native-project parsing');
    });
    const stream = vi.fn(() => chunkedUtf8Stream(projectText, [1, 7, 31, 127]));
    // At or above the streaming point the tokenizer stays in charge, whatever
    // the fixture's real byte length is.
    const blob = { size: PROJECT_NATIVE_JSON_PARSE_MAX_BYTES, text, stream } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource({ id: 41, kind: 'project', blob }, onParsing);

    expect(response).toEqual({
      id: 41,
      kind: 'project',
      result: deserializeProject(projectText),
    });
    expect(text).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('returns the established invalid result for malformed streamed JSON', async () => {
    const malformed = '{"schemaVersion":3,"scene":]';
    const text = vi.fn(async () => {
      throw new Error('malformed production input must not use Blob.text()');
    });
    const blob = {
      size: PROJECT_NATIVE_JSON_PARSE_MAX_BYTES,
      text,
      stream: () => chunkedUtf8Stream(malformed, [1, 13, 27]),
    } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource({ id: 42, kind: 'project', blob }, onParsing);

    expect(response).toMatchObject({
      id: 42,
      kind: 'project',
      result: { kind: 'invalid', reason: expect.stringMatching(/^not valid JSON: /) },
    });
    expect(text).not.toHaveBeenCalled();
    expect(onParsing).not.toHaveBeenCalled();
  });

  it('propagates a partial stream failure without retrying through whole text', async () => {
    const text = vi.fn(async () => serializeProject(createProject()));
    let pull = 0;
    const blob = {
      size: PROJECT_NATIVE_JSON_PARSE_MAX_BYTES,
      text,
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull === 0) {
              pull += 1;
              controller.enqueue(new TextEncoder().encode('{"schemaVersion":3,'));
              return;
            }
            controller.error(new Error('fixture project stream failed after one chunk'));
          },
        }),
    } as unknown as Blob;
    const onParsing = vi.fn();

    await expect(
      parseDocumentImportSource({ id: 43, kind: 'project', blob }, onParsing),
    ).rejects.toThrow('fixture project stream failed after one chunk');
    expect(text).not.toHaveBeenCalled();
    expect(pull).toBe(1);
    expect(onParsing).not.toHaveBeenCalled();
  });

  it('preserves the whole-text compatibility path when Blob.stream is unavailable', async () => {
    const projectText = serializeProject(createProject());
    const text = vi.fn(async () => projectText);
    const blob = { size: projectText.length, text, stream: undefined } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource({ id: 44, kind: 'project', blob }, onParsing);

    expect(response).toEqual({ id: 44, kind: 'project', result: deserializeProject(projectText) });
    expect(text).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('keeps project validation and normalization identical after streamed parsing', () => {
    const projectText = serializeProject(createProject());
    expect(deserializeProjectValue(JSON.parse(projectText))).toEqual(
      deserializeProject(projectText),
    );
  });

  it.each([
    ['escaped lone high surrogate', `before${String.fromCharCode(0xd800)}after`],
    ['escaped lone low surrogate', `before${String.fromCharCode(0xdc00)}after`],
    ['literal leading byte-order mark', '\uFEFFbefore'],
  ])('preserves project notes code units for %s', async (_label, notes) => {
    const projectText = serializeProject({ ...createProject(), notes });
    const blob = {
      size: PROJECT_NATIVE_JSON_PARSE_MAX_BYTES,
      text: vi.fn(async () => {
        throw new Error('string-fidelity cases must use the stream path');
      }),
      stream: () => chunkedUtf8Stream(projectText, [1, 19, 127]),
    } as unknown as Blob;

    const response = await parseDocumentImportSource({ id: 45, kind: 'project', blob }, vi.fn());

    expect(response).toMatchObject({ kind: 'project', result: { kind: 'ok' } });
    if (response.kind !== 'project' || response.result.kind !== 'ok') {
      throw new Error('expected a valid streamed project');
    }
    expect(codeUnits(response.result.project.notes)).toEqual(codeUnits(notes));
  });
});

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

function codeUnits(value: string): number[] {
  return Array.from({ length: value.length }, (_unused, index) => value.charCodeAt(index));
}
