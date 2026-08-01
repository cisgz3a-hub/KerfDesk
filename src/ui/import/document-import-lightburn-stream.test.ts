import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseDocumentImportText } from './document-import-parse';
import { parseDocumentImportSource } from './document-import-source';

const LBRN_TEXT = `<LightBurnProject AppVersion="1.7 ☃">
  <Shape Type="Rect" CutIndex="2" W="10" H="6">
    <XForm>1 0 0 1 5 5</XForm>
  </Shape>
</LightBurnProject>`;

const CLB_TEXT = `<Library><Material Name="Birch ☃"><Entry Thickness="3" Desc="Cut">
  <CutSetting Type="Cut" Speed="8" MaxPower="75"/>
</Entry></Material></Library>`;

const LBRN_FIXTURES = [
  'acwright-plate.lbrn2',
  'acwright-db25-helper-top.lbrn2',
  'acwright-backplane-top.lbrn2',
  'acwright-keypad-helper-top.lbrn2',
  'acwright-joystick-helper-top.lbrn2',
] as const;

const CLB_FIXTURES = [
  'ddlab-laser-settings-current.clb',
  'ddlab-laser-settings-legacy.clb',
  'h3mul-main-material-library.clb',
  'jayson-big-blue-laser.clb',
  'jayson-tmx90-empty.clb',
] as const;

describe('parseDocumentImportSource LightBurn streaming', () => {
  it('streams a LightBurn project without retaining a whole source string', async () => {
    const { blob, stream, text } = streamedBlob(LBRN_TEXT);
    const request = {
      id: 21,
      kind: 'lightburn-project' as const,
      blob,
      source: 'streamed.lbrn2',
    };
    const expected = await parseDocumentImportText(request, LBRN_TEXT);
    const onParsing = vi.fn();

    await expect(parseDocumentImportSource(request, onParsing)).resolves.toEqual(expected);
    expect(text).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it('streams a LightBurn CLB without retaining a whole source string', async () => {
    const { blob, stream, text } = streamedBlob(CLB_TEXT);
    const request = {
      id: 22,
      kind: 'lightburn-clb' as const,
      blob,
      source: 'streamed.clb',
    };
    const expected = await parseDocumentImportText(request, CLB_TEXT);
    const onParsing = vi.fn();

    await expect(parseDocumentImportSource(request, onParsing)).resolves.toEqual(expected);
    expect(text).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(onParsing).toHaveBeenCalledTimes(1);
  });

  it.each(LBRN_FIXTURES)('matches the established project importer for %s', async (source) => {
    const xml = fixture('lbrn', source);
    const { blob, text } = streamedBlob(xml);
    const request = { id: 23, kind: 'lightburn-project' as const, blob, source };

    await expect(parseDocumentImportSource(request, vi.fn())).resolves.toEqual(
      await parseDocumentImportText(request, xml),
    );
    expect(text).not.toHaveBeenCalled();
  });

  it.each(CLB_FIXTURES)('matches the established CLB importer for %s', async (source) => {
    const xml = fixture('clb', source);
    const { blob, text } = streamedBlob(xml);
    const request = { id: 24, kind: 'lightburn-clb' as const, blob, source };

    await expect(parseDocumentImportSource(request, vi.fn())).resolves.toEqual(
      await parseDocumentImportText(request, xml),
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('preserves the text parser when Blob.stream is unavailable', async () => {
    const text = vi.fn(async () => LBRN_TEXT);
    const blob = { size: LBRN_TEXT.length, text, stream: undefined } as unknown as Blob;
    const request = {
      id: 25,
      kind: 'lightburn-project' as const,
      blob,
      source: 'legacy.lbrn2',
    };

    await expect(parseDocumentImportSource(request, vi.fn())).resolves.toEqual(
      await parseDocumentImportText(request, LBRN_TEXT),
    );
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('retains active-declaration rejection across stream chunk boundaries', async () => {
    const active = '<!DOCTYPE project [<!ENTITY x "y">]><LightBurnProject>&x;</LightBurnProject>';
    const { blob, text } = streamedBlob(active, [2, 6, 12, 24, 37]);
    const request = {
      id: 26,
      kind: 'lightburn-project' as const,
      blob,
      source: 'active.lbrn2',
    };

    await expect(parseDocumentImportSource(request, vi.fn())).resolves.toEqual(
      await parseDocumentImportText(request, active),
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('preserves project extension precedence after well-formed active declarations', async () => {
    const active = '<!DOCTYPE project><LightBurnProject/>';
    const { blob, text } = streamedBlob(active, [2, 11, 25]);
    const request = {
      id: 29,
      kind: 'lightburn-project' as const,
      blob,
      source: 'wrong.txt',
    };

    await expect(parseDocumentImportSource(request, vi.fn())).resolves.toEqual(
      await parseDocumentImportText(request, active),
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('retains malformed-XML failure semantics without whole-text retry', async () => {
    const malformed = '<Library><Entry></Library>';
    const { blob, text } = streamedBlob(malformed, [4, 17]);
    const request = {
      id: 27,
      kind: 'lightburn-clb' as const,
      blob,
      source: 'broken.clb',
    };

    await expect(parseDocumentImportSource(request, vi.fn())).resolves.toEqual(
      await parseDocumentImportText(request, malformed),
    );
    expect(text).not.toHaveBeenCalled();
  });

  it('does not fall through to Blob.text after a partial stream failure', async () => {
    const text = vi.fn(async () => LBRN_TEXT);
    let pull = 0;
    const stream = vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull === 0) {
              pull += 1;
              controller.enqueue(new TextEncoder().encode('<LightBurnProject>'));
              return;
            }
            controller.error(new Error('LightBurn fixture stream failed after one chunk'));
          },
        }),
    );
    const blob = { size: LBRN_TEXT.length, text, stream } as unknown as Blob;
    const onParsing = vi.fn();

    await expect(
      parseDocumentImportSource(
        { id: 28, kind: 'lightburn-project', blob, source: 'failed.lbrn2' },
        onParsing,
      ),
    ).rejects.toThrow('LightBurn fixture stream failed after one chunk');
    expect(pull).toBe(1);
    expect(text).not.toHaveBeenCalled();
    expect(onParsing).not.toHaveBeenCalled();
  });
});

function streamedBlob(
  source: string,
  requestedCuts?: ReadonlyArray<number>,
): {
  readonly blob: Blob;
  readonly stream: ReturnType<typeof vi.fn>;
  readonly text: ReturnType<typeof vi.fn>;
} {
  const encoded = new TextEncoder().encode(source);
  const snowman = encoded.indexOf(0xe2);
  const defaultCuts = [
    7,
    31,
    Math.floor(encoded.length / 2),
    ...(snowman < 0 ? [] : [snowman + 1, snowman + 2]),
    encoded.length - 5,
  ];
  const cuts = [...new Set(requestedCuts ?? defaultCuts)]
    .filter((cut) => cut > 0 && cut < encoded.length)
    .sort((left, right) => left - right);
  const stream = vi.fn(() => chunkedUtf8Stream(encoded, cuts));
  const text = vi.fn(async () => {
    throw new Error('whole Blob.text() is forbidden for production LightBurn parsing');
  });
  return {
    blob: { size: encoded.length, stream, text } as unknown as Blob,
    stream,
    text,
  };
}

function fixture(kind: 'lbrn' | 'clb', name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'src/__fixtures__/lightburn/external', kind, name),
    'utf8',
  );
}

function chunkedUtf8Stream(
  encoded: Uint8Array,
  cuts: ReadonlyArray<number>,
): ReadableStream<Uint8Array> {
  const boundaries = [0, ...cuts, encoded.length];
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= boundaries.length - 1) {
        controller.close();
        return;
      }
      const start = boundaries[index] ?? 0;
      const end = boundaries[index + 1] ?? encoded.length;
      index += 1;
      controller.enqueue(encoded.slice(start, end));
    },
  });
}
