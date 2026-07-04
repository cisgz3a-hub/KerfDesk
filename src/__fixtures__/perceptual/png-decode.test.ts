import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png-decode';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

type PngOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlace?: number;
  readonly raw?: Uint8Array;
  readonly includeIhdr?: boolean;
  readonly includeIdat?: boolean;
  readonly includeIend?: boolean;
};

describe('decodePng', () => {
  it('decodes non-interlaced 8-bit RGB PNG bytes', () => {
    const image = decodePng(makePng({ raw: new Uint8Array([0, 12, 34, 56]) }));

    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect([...image.data]).toEqual([12, 34, 56, 255]);
  });

  it('decodes non-interlaced 8-bit RGBA PNG bytes', () => {
    const image = decodePng(makePng({ colorType: 6, raw: new Uint8Array([0, 12, 34, 56, 78]) }));

    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect([...image.data]).toEqual([12, 34, 56, 78]);
  });

  it('rejects non-PNG bytes', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('Not a PNG');
  });

  it('rejects unsupported bit depths', () => {
    expect(() => decodePng(makePng({ bitDepth: 16 }))).toThrow('PNG bit depth 16 unsupported');
  });

  it('rejects unsupported colour types', () => {
    expect(() => decodePng(makePng({ colorType: 0 }))).toThrow('PNG colour type 0 unsupported');
  });

  it('rejects interlaced PNGs', () => {
    expect(() => decodePng(makePng({ interlace: 1 }))).toThrow('Interlaced PNG unsupported');
  });

  it('rejects missing required chunks', () => {
    expect(() => decodePng(makePng({ includeIhdr: false }))).toThrow('PNG missing IHDR chunk');
    expect(() => decodePng(makePng({ includeIdat: false }))).toThrow('PNG missing IDAT chunk');
    expect(() => decodePng(makePng({ includeIend: false }))).toThrow('PNG missing IEND chunk');
  });

  it('rejects incomplete chunk payloads', () => {
    const bytes = concat([PNG_SIGNATURE, chunk('IHDR', makeIhdr()).subarray(0, 16)]);

    expect(() => decodePng(bytes)).toThrow('Malformed PNG IHDR chunk');
  });

  it('rejects truncated decoded pixel rows instead of zero-filling missing bytes', () => {
    expect(() => decodePng(makePng({ raw: new Uint8Array([0, 12]) }))).toThrow(
      'PNG pixel data length 2 invalid (expected 4)',
    );
  });

  it('rejects unknown PNG row filters', () => {
    expect(() => decodePng(makePng({ raw: new Uint8Array([5, 12, 34, 56]) }))).toThrow(
      'Unknown PNG filter 5',
    );
  });
});

function makePng(options: PngOptions = {}): Uint8Array {
  const width = options.width ?? 1;
  const height = options.height ?? 1;
  const colorType = options.colorType ?? 2;
  const raw = options.raw ?? defaultRaw(colorType);
  const chunks: Uint8Array[] = [];
  if (options.includeIhdr !== false) {
    chunks.push(
      chunk(
        'IHDR',
        makeIhdr({
          width,
          height,
          bitDepth: options.bitDepth ?? 8,
          colorType,
          interlace: options.interlace ?? 0,
        }),
      ),
    );
  }
  if (options.includeIdat !== false) chunks.push(chunk('IDAT', new Uint8Array(deflateSync(raw))));
  if (options.includeIend !== false) chunks.push(chunk('IEND', new Uint8Array(0)));
  return concat([PNG_SIGNATURE, ...chunks]);
}

function defaultRaw(colorType: number): Uint8Array {
  return colorType === 6 ? new Uint8Array([0, 1, 2, 3, 4]) : new Uint8Array([0, 1, 2, 3]);
}

function makeIhdr(
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly bitDepth?: number;
    readonly colorType?: number;
    readonly interlace?: number;
  } = {},
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width ?? 1);
  view.setUint32(4, options.height ?? 1);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = options.colorType ?? 2;
  ihdr[12] = options.interlace ?? 0;
  return ihdr;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat([typeBytes, data])));
  return out;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
