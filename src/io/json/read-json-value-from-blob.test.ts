import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readJsonValueFromBlob, StreamedJsonSyntaxError } from './read-json-value-from-blob';

describe('readJsonValueFromBlob', () => {
  it.each([
    ['object and duplicate keys', '{"a":1,"nested":[true,null,"x"],"a":2}'],
    ['number semantics', '[0,-0,1.25,1e999,5e-324]'],
    ['escaped and supplementary Unicode', '{"text":"snowman \\u2603 and 🧪"}'],
    ['prototype-shaped own properties', '{"__proto__":{"polluted":true},"constructor":"own"}'],
    ['top-level primitive', 'false'],
    ['trailing whitespace', '{"ok":true}\r\n  \t'],
  ])('matches JSON.parse for %s across one-byte chunks', async (_label, source) => {
    const bytes = new TextEncoder().encode(source);
    const blob = {
      stream: () => byteStream(bytes),
    } as unknown as Blob;

    expect(await readJsonValueFromBlob(blob)).toEqual(JSON.parse(source));
  });

  it('preserves __proto__ as an own data property without changing object prototypes', async () => {
    const source = '{"__proto__":{"polluted":true}}';
    const blob = {
      stream: () => byteStream(new TextEncoder().encode(source)),
    } as unknown as Blob;
    const parsed = (await readJsonValueFromBlob(blob)) as Record<string, unknown>;

    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(parsed['__proto__']).toEqual({ polluted: true });
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it.each([
    '',
    '{',
    '[1,]',
    '[,]',
    '[1 2]',
    '{"a":}',
    '{"a":1,}',
    '{"a" 1}',
    '{"a":1 "b":2}',
    '01',
    '-.1',
    '1.',
    '1e+',
    '--1',
    'true false',
    '{}{}',
    'NaN',
    '"unterminated',
    '"\\u12"',
    '"\\x"',
    '"literal\u0001control"',
  ])('rejects malformed JSON %j as syntax, not an infrastructure failure', async (source) => {
    const blob = {
      stream: () => byteStream(new TextEncoder().encode(source)),
    } as unknown as Blob;

    await expect(readJsonValueFromBlob(blob)).rejects.toBeInstanceOf(StreamedJsonSyntaxError);
  });

  it('matches Blob UTF-8 decoding for a leading BOM and malformed byte replacement', async () => {
    const bytes = Uint8Array.from([
      0xef, 0xbb, 0xbf, 0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d,
    ]);
    const blob = { stream: () => byteStream(bytes) } as unknown as Blob;

    expect(await readJsonValueFromBlob(blob)).toEqual({ x: '\uFFFD' });
  });

  it.each([
    ['escaped lone high surrogate', '"\\ud800"'],
    ['escaped lone low surrogate', '"\\udc00"'],
    ['escaped lone high surrogate before text', '"\\ud800x"'],
    ['escaped surrogate pair', '"\\ud800\\udc00"'],
    ['escaped byte-order mark', '"\\ufeff"'],
    ['literal in-string byte-order mark', `"\uFEFF"`],
  ])('matches JSON.parse code units for %s', async (_label, source) => {
    const blob = {
      stream: () => byteStream(new TextEncoder().encode(source)),
    } as unknown as Blob;

    expect(codeUnits(await readJsonValueFromBlob(blob))).toEqual(codeUnits(JSON.parse(source)));
  });

  it('preserves UTF-16-sensitive object keys with JSON.parse semantics', async () => {
    const source = '{"\\ud800":1,"\\ufeff":2}';
    const blob = {
      stream: () => byteStream(new TextEncoder().encode(source)),
    } as unknown as Blob;
    const actual = (await readJsonValueFromBlob(blob)) as Record<string, unknown>;
    const expected = JSON.parse(source) as Record<string, unknown>;

    expect(Object.keys(actual).map(codeUnits)).toEqual(Object.keys(expected).map(codeUnits));
    expect(actual).toEqual(expected);
  });

  it('preserves code units when a string spans internal tokenizer buffers', async () => {
    const source = JSON.stringify(
      `${'a'.repeat(4_095)}${String.fromCharCode(0xd800)}${'b'.repeat(4_096)}\uFEFF`,
    );
    const blob = {
      stream: () => byteStream(new TextEncoder().encode(source)),
    } as unknown as Blob;

    expect(codeUnits(await readJsonValueFromBlob(blob))).toEqual(codeUnits(JSON.parse(source)));
  });

  it('matches JSON.parse across a deterministic generated corpus', async () => {
    await fc.assert(
      fc.asyncProperty(fc.json(), async (source) => {
        const blob = {
          stream: () => byteStream(new TextEncoder().encode(source)),
        } as unknown as Blob;
        expect(await readJsonValueFromBlob(blob)).toEqual(JSON.parse(source));
      }),
      { seed: 2_026_080_2, numRuns: 2_000 },
    );
  });

  it('preserves a source-stream failure as infrastructure failure', async () => {
    const failure = new Error('source read failed');
    let pull = 0;
    const blob = {
      stream: () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull === 0) {
              pull += 1;
              controller.enqueue(new TextEncoder().encode('{"a":'));
              return;
            }
            controller.error(failure);
          },
        }),
    } as unknown as Blob;

    await expect(readJsonValueFromBlob(blob)).rejects.toBe(failure);
  });
});

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + 1));
      offset += 1;
    },
  });
}

function codeUnits(value: unknown): number[] {
  if (typeof value !== 'string') throw new Error('expected a JSON string');
  return Array.from({ length: value.length }, (_unused, index) => value.charCodeAt(index));
}
