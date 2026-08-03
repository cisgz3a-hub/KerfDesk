import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import {
  parseDocumentImportSource,
  PROJECT_NATIVE_JSON_PARSE_MAX_BYTES,
} from './document-import-source';

describe('parseDocumentImportSource native-project JSON.parse fast path', () => {
  it('parses a below-threshold project with Blob.text() instead of the tokenizer', async () => {
    const projectText = serializeProject(createProject());
    const text = vi.fn(async () => projectText);
    const stream = vi.fn(() => {
      throw new Error('a below-threshold project must not use the streaming tokenizer');
    });
    const blob = { size: projectText.length, text, stream } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource({ id: 61, kind: 'project', blob }, onParsing);

    expect(response).toEqual({ id: 61, kind: 'project', result: deserializeProject(projectText) });
    expect(text).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('produces an identical project through the native and streaming paths', async () => {
    const projectText = serializeProject({
      ...createProject(),
      notes: 'equivalence snowman ☃ and supplementary \u{1f9ea}',
    });
    const nativeResponse = await parseDocumentImportSource(
      { id: 62, kind: 'project', blob: projectBlob(projectText, projectText.length) },
      vi.fn(),
    );
    const streamedResponse = await parseDocumentImportSource(
      {
        id: 62,
        kind: 'project',
        blob: projectBlob(projectText, PROJECT_NATIVE_JSON_PARSE_MAX_BYTES),
      },
      vi.fn(),
    );

    expect(nativeResponse).toEqual(streamedResponse);
    expect(nativeResponse).toEqual({
      id: 62,
      kind: 'project',
      result: deserializeProject(projectText),
    });
  });

  it('keeps the streaming tokenizer at the threshold', async () => {
    const projectText = serializeProject(createProject());
    const text = vi.fn(async () => projectText);
    const stream = vi.fn(() => utf8Stream(projectText));
    const blob = { size: PROJECT_NATIVE_JSON_PARSE_MAX_BYTES, text, stream } as unknown as Blob;

    const response = await parseDocumentImportSource({ id: 63, kind: 'project', blob }, vi.fn());

    expect(response).toEqual({ id: 63, kind: 'project', result: deserializeProject(projectText) });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it('uses the native path one byte below the threshold', async () => {
    const projectText = serializeProject(createProject());
    const text = vi.fn(async () => projectText);
    const stream = vi.fn(() => utf8Stream(projectText));
    const blob = { size: PROJECT_NATIVE_JSON_PARSE_MAX_BYTES - 1, text, stream } as unknown as Blob;

    const response = await parseDocumentImportSource({ id: 64, kind: 'project', blob }, vi.fn());

    expect(response).toEqual({ id: 64, kind: 'project', result: deserializeProject(projectText) });
    expect(text).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
  });

  it('returns the established invalid result for malformed below-threshold JSON', async () => {
    const malformed = '{"schemaVersion":3,"scene":]';
    const blob = projectBlob(malformed, malformed.length);

    const response = await parseDocumentImportSource({ id: 65, kind: 'project', blob }, vi.fn());

    expect(response).toMatchObject({
      id: 65,
      kind: 'project',
      result: { kind: 'invalid', reason: expect.stringMatching(/^not valid JSON: /) },
    });
  });

  it.each([
    ['escaped lone high surrogate', `before${String.fromCharCode(0xd800)}after`],
    ['escaped lone low surrogate', `before${String.fromCharCode(0xdc00)}after`],
    ['literal leading byte-order mark', '\uFEFFbefore'],
  ])('preserves natively parsed project notes code units for %s', async (_label, notes) => {
    const projectText = serializeProject({ ...createProject(), notes });
    const blob = projectBlob(projectText, projectText.length);

    const response = await parseDocumentImportSource({ id: 66, kind: 'project', blob }, vi.fn());

    if (response.kind !== 'project' || response.result.kind !== 'ok') {
      throw new Error('expected a valid natively parsed project');
    }
    expect(codeUnits(response.result.project.notes)).toEqual(codeUnits(notes));
  });
});

function projectBlob(text: string, size: number): Blob {
  return { size, text: async () => text, stream: () => utf8Stream(text) } as unknown as Blob;
}

function utf8Stream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function codeUnits(value: string): number[] {
  return Array.from({ length: value.length }, (_unused, index) => value.charCodeAt(index));
}
