import { describe, expect, it, vi } from 'vitest';
import { parseSvgInWorker } from '../../io/svg/parse-svg-worker';
import { parseDocumentImportText } from './document-import-parse';
import { parseDocumentImportSource } from './document-import-source';

const SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
  <defs><path id="mark" d="M1 1 L9 1 L9 9 Z"/></defs>
  <g transform="translate(2 0)" stroke="#ff0000"><use href="#mark"/></g>
  <title>snowman ☃</title>
  <script>alert(1)</script>
</svg>`;

describe('parseDocumentImportSource SVG streaming', () => {
  it('uses Blob.stream without retaining a whole source string', async () => {
    const text = vi.fn(async () => {
      throw new Error('whole Blob.text() is forbidden for production SVG parsing');
    });
    const encoded = new TextEncoder().encode(SVG_TEXT);
    const snowmanStart = encoded.indexOf(0xe2);
    const stream = vi.fn(() =>
      chunkedUtf8Stream(SVG_TEXT, [7, 31, 79, snowmanStart + 1, snowmanStart + 2]),
    );
    const blob = {
      size: new TextEncoder().encode(SVG_TEXT).byteLength,
      text,
      stream,
    } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource(
      { id: 4, kind: 'svg', blob, objectId: 'svg-4', source: 'streamed.svg' },
      onParsing,
    );

    expect(response).toEqual({
      id: 4,
      kind: 'svg',
      result: parseSvgInWorker({
        svgText: SVG_TEXT,
        id: 'svg-4',
        source: 'streamed.svg',
      }),
    });
    expect(text).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('keeps malformed SVG as an explicit parse error', async () => {
    const malformed = '<svg><g></svg>';
    const request = {
      id: 5,
      kind: 'svg' as const,
      blob: new Blob(),
      objectId: 'svg-5',
      source: 'broken.svg',
    };
    const establishedError = await parseDocumentImportText(request, malformed).catch(
      (error: unknown) => error,
    );
    expect(establishedError).toBeInstanceOf(Error);
    const blob = {
      size: malformed.length,
      text: vi.fn(async () => {
        throw new Error('whole text path must stay unused');
      }),
      stream: () => chunkedUtf8Stream(malformed, [5, 9]),
    } as unknown as Blob;

    await expect(parseDocumentImportSource({ ...request, blob }, vi.fn())).rejects.toMatchObject({
      message: (establishedError as Error).message,
    });
  });

  it('leaves non-SVG document imports on their existing text parser', async () => {
    const text = vi.fn(async () => '{"schemaVersion":null}');
    const blob = {
      size: 22,
      text,
      stream: vi.fn(() => {
        throw new Error('project import must not enter the SVG stream parser');
      }),
    } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource({ id: 6, kind: 'project', blob }, onParsing);

    expect(response).toMatchObject({ id: 6, kind: 'project', result: { kind: 'invalid' } });
    expect(text).toHaveBeenCalledTimes(1);
    expect(blob.stream).not.toHaveBeenCalled();
    expect(onParsing).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('preserves the text parser when Blob.stream is unavailable', async () => {
    const text = vi.fn(async () => SVG_TEXT);
    const blob = { size: SVG_TEXT.length, text, stream: undefined } as unknown as Blob;
    const onParsing = vi.fn();

    const response = await parseDocumentImportSource(
      { id: 7, kind: 'svg', blob, objectId: 'svg-7', source: 'legacy.svg' },
      onParsing,
    );

    expect(response).toEqual({
      id: 7,
      kind: 'svg',
      result: parseSvgInWorker({ svgText: SVG_TEXT, id: 'svg-7', source: 'legacy.svg' }),
    });
    expect(text).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('does not fall through to whole-text parsing after a partial stream failure', async () => {
    const text = vi.fn(async () => SVG_TEXT);
    let pull = 0;
    const stream = vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull === 0) {
              pull += 1;
              controller.enqueue(new TextEncoder().encode('<svg>'));
              return;
            }
            controller.error(new Error('fixture stream failed after one chunk'));
          },
        }),
    );
    const blob = { size: SVG_TEXT.length, text, stream } as unknown as Blob;
    const onParsing = vi.fn();

    await expect(
      parseDocumentImportSource(
        { id: 8, kind: 'svg', blob, objectId: 'svg-8', source: 'failed.svg' },
        onParsing,
      ),
    ).rejects.toThrow('fixture stream failed after one chunk');
    expect(pull).toBe(1);
    expect(text).not.toHaveBeenCalled();
    expect(onParsing).not.toHaveBeenCalled();
  });

  it.each([
    [
      'xlink namespace',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
        <defs><path id="p" d="M0 0 L5 5"/></defs><use xlink:href="#p" stroke="red"/>
      </svg>`,
    ],
    [
      'entities and CDATA',
      `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <title><![CDATA[one < two]]></title><rect x="&#49;" y="1" width="8" height="8" stroke="black" fill="none"/>
      </svg>`,
    ],
    [
      'sanitized active content',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <script>alert(1)</script><foreignObject/><use href="https://example.com/a" onload="bad()"/>
        <path d="M0 0 L9 9" stroke="black"/>
      </svg>`,
    ],
    [
      'literal LF in an id attribute',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <defs><path id="a
b" d="M0 0 L9 9"/></defs><use href="#a b" stroke="red"/>
      </svg>`,
    ],
    [
      'literal TAB in an id attribute',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <defs><path id="a	b" d="M0 0 L9 9"/></defs><use href="#a b" stroke="red"/>
      </svg>`,
    ],
    [
      'literal CR in an id attribute',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<defs><path id="a\rb" d="M0 0 L9 9"/></defs><use href="#a b" stroke="red"/>' +
        '</svg>',
    ],
    [
      'XML 1.1 literal NEL in an id attribute',
      '<?xml version="1.1"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<defs><path id="a\u0085b" d="M0 0 L9 9"/></defs><use href="#a b" stroke="red"/>' +
        '</svg>',
    ],
    [
      'XML 1.1 literal line separator in an id attribute',
      '<?xml version="1.1"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<defs><path id="a\u2028b" d="M0 0 L9 9"/></defs><use href="#a b" stroke="red"/>' +
        '</svg>',
    ],
  ])('matches the established worker result for %s', async (_label, svgText) => {
    const blob = {
      size: new TextEncoder().encode(svgText).byteLength,
      text: vi.fn(async () => {
        throw new Error('parity cases must use the stream path');
      }),
      stream: () => chunkedUtf8Stream(svgText, [1, 11, 47, 83]),
    } as unknown as Blob;

    const response = await parseDocumentImportSource(
      { id: 9, kind: 'svg', blob, objectId: 'svg-9', source: 'parity.svg' },
      vi.fn(),
    );

    expect(response).toEqual({
      id: 9,
      kind: 'svg',
      result: parseSvgInWorker({ svgText, id: 'svg-9', source: 'parity.svg' }),
    });
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
