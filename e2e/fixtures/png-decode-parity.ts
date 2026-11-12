// In-page fixture for e2e/png-own-size-decode-parity.e2e.ts: PNG variants
// built with the browser's own zlib, and the two ways the image loader has
// drawn a PNG at its own size, each read back exactly as the trace dialog's
// worker reads it.

import { decodeImageOntoCanvas } from '../../src/ui/trace/image-loader';
import { snapshotCanvas } from '../../src/ui/import/image-luma-worker-client';

interface Variant {
  readonly name: string;
  readonly colorType: 0 | 2 | 3 | 4 | 6;
  readonly depth: 8 | 16;
  readonly interlace?: boolean;
  readonly chunks?: readonly (readonly [string, Uint8Array])[];
}

export interface ParityRow {
  readonly name: string;
  readonly size: readonly [number, number];
  readonly differingBytes: number;
  // The loader decoded the file itself with createImageBitmap (not an <img>).
  readonly decodedAsBitmap: boolean;
}

const WIDTH = 301;
const HEIGHT = 203;
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat(
    Uint8Array.from(type, (c) => c.charCodeAt(0)),
    data,
  );
  return concat(u32(data.length), body, u32(crc(body)));
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function sample(x: number, y: number, channel: number): number {
  const values = [
    ((x * 7 + y * 3) % WIDTH) / WIDTH,
    ((y * 5 + x) % HEIGHT) / HEIGHT,
    ((x ^ y) & 255) / 256,
    (((x + y) * 13) % 256) / 256,
  ];
  return Math.min(0.9999, values[channel] ?? 0);
}

function scanlines(
  variant: Variant,
  xs: number[],
  ys: number[],
  invert = false,
): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const y of ys) {
    out.push(0);
    for (const x of xs) {
      for (let channel = 0; channel < CHANNELS[variant.colorType]; channel += 1) {
        if (variant.colorType === 3) out.push((x * 31 + y * 17) % 16);
        else if (variant.depth === 8)
          out.push(Math.floor(sample(x, y, channel) * 256) ^ (invert ? 255 : 0));
        else {
          const value = Math.floor(sample(x, y, channel) * 65536);
          out.push(value >> 8, value & 255);
        }
      }
    }
  }
  return Uint8Array.from(out);
}

function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let value = start; value < end; value += step) out.push(value);
  return out;
}

function imageData(variant: Variant): Uint8Array<ArrayBuffer> {
  if (variant.interlace !== true) {
    return scanlines(variant, range(0, WIDTH, 1), range(0, HEIGHT, 1));
  }
  return concat(
    ...ADAM7.map(([x0, y0, dx, dy]) =>
      scanlines(variant, range(x0, WIDTH, dx), range(y0, HEIGHT, dy)),
    ),
  );
}

function header(variant: Variant): Uint8Array {
  return concat(
    u32(WIDTH),
    u32(HEIGHT),
    Uint8Array.from([variant.depth, variant.colorType, 0, 0, variant.interlace === true ? 1 : 0]),
  );
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function pngFile(variant: Variant): Promise<File> {
  const parts = [SIGNATURE, chunk('IHDR', header(variant))];
  for (const [type, data] of variant.chunks ?? []) parts.push(chunk(type, data));
  if (variant.colorType === 3) {
    parts.push(
      chunk(
        'PLTE',
        Uint8Array.from({ length: 48 }, (_, i) => (i * 53) & 255),
      ),
    );
    parts.push(chunk('tRNS', Uint8Array.from([255, 0, 128, 64, 200, 255, 10, 255])));
  }
  parts.push(chunk('IDAT', await deflate(imageData(variant))), chunk('IEND', new Uint8Array()));
  return new File([concat(...parts)], `${variant.name}.png`, { type: 'image/png' });
}

/** Two frames; a renderer that advanced the animation would show the second. */
async function apngFile(): Promise<File> {
  const variant: Variant = { name: 'apng', colorType: 6, depth: 8 };
  const rows = [range(0, WIDTH, 1), range(0, HEIGHT, 1)] as const;
  const frame = (sequence: number): Uint8Array =>
    concat(
      u32(sequence),
      u32(WIDTH),
      u32(HEIGHT),
      u32(0),
      u32(0),
      Uint8Array.from([0, 1, 0, 10, 0, 0]),
    );
  const second = concat(u32(2), await deflate(scanlines(variant, ...rows, true)));
  const parts = [
    SIGNATURE,
    chunk('IHDR', header(variant)),
    chunk('acTL', concat(u32(2), u32(0))),
    chunk('fcTL', frame(0)),
    chunk('IDAT', await deflate(scanlines(variant, ...rows))),
    chunk('fcTL', frame(1)),
    chunk('fdAT', second),
    chunk('IEND', new Uint8Array()),
  ];
  return new File([concat(...parts)], 'apng.png', { type: 'image/png' });
}

/** A Display P3 canvas encodes its colour space as an iCCP profile. */
async function displayP3File(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d', { colorSpace: 'display-p3' });
  if (context === null) throw new Error('No Display P3 canvas');
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, 'color(display-p3 1 0 0)');
  gradient.addColorStop(0.5, 'color(display-p3 0 1 0.3 / 0.6)');
  gradient.addColorStop(1, 'color(display-p3 0.1 0.2 1)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('No PNG');
  return new File([blob], 'display-p3.png', { type: 'image/png' });
}

function exif(orientation: number): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x4d, 0, 42]);
  view.setUint32(4, 8);
  view.setUint16(8, 1);
  view.setUint16(10, 0x0112);
  view.setUint16(12, 3);
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  return bytes;
}

const VARIANTS: readonly Variant[] = [
  { name: 'grey 8', colorType: 0, depth: 8 },
  { name: 'grey 16', colorType: 0, depth: 16 },
  { name: 'RGB 8', colorType: 2, depth: 8 },
  { name: 'RGB 16', colorType: 2, depth: 16 },
  { name: 'palette with tRNS', colorType: 3, depth: 8 },
  { name: 'grey-alpha 8', colorType: 4, depth: 8 },
  { name: 'RGBA 8', colorType: 6, depth: 8 },
  { name: 'RGBA 16', colorType: 6, depth: 16 },
  { name: 'RGB gAMA 1.8', colorType: 2, depth: 8, chunks: [['gAMA', u32(55556)]] },
  { name: 'RGBA gAMA 2.2', colorType: 6, depth: 8, chunks: [['gAMA', u32(45455)]] },
  { name: 'RGB sRGB', colorType: 2, depth: 8, chunks: [['sRGB', Uint8Array.from([0])]] },
  {
    name: 'RGB cHRM',
    colorType: 2,
    depth: 8,
    chunks: [
      ['cHRM', concat(...[31270, 32900, 70000, 30000, 20000, 70000, 10000, 5000].map(u32))],
      ['gAMA', u32(45455)],
    ],
  },
  { name: 'RGB Adam7', colorType: 2, depth: 8, interlace: true },
  { name: 'RGBA 16 Adam7', colorType: 6, depth: 16, interlace: true },
  { name: 'RGB eXIf 6', colorType: 2, depth: 8, chunks: [['eXIf', exif(6)]] },
  { name: 'RGBA eXIf 3', colorType: 6, depth: 8, chunks: [['eXIf', exif(3)]] },
];

function readBack(bitmap: ImageBitmap): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('No readback canvas');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** The previous own-size route: an <img> drawn on the loader's canvas. */
async function elementPixels(file: File): Promise<Uint8ClampedArray> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, image.width, image.height);
    return readBack(await snapshotCanvas(canvas));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function differingBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let count = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) count += 1;
  return count;
}

/** Files the page has handed to createImageBitmap since this was installed. */
function recordBitmapDecodes(): Set<unknown> {
  const decoded = new Set<unknown>();
  const original = window.createImageBitmap.bind(window);
  window.createImageBitmap = ((source: ImageBitmapSource, ...rest: never[]) => {
    decoded.add(source);
    return original(source, ...rest);
  }) as typeof window.createImageBitmap;
  return decoded;
}

/** Each variant through the loader's own route against the previous one. */
export async function pngDecodeParity(): Promise<ParityRow[]> {
  const decoded = recordBitmapDecodes();
  const files = [
    ...(await Promise.all(VARIANTS.map(pngFile))),
    await displayP3File(),
    await apngFile(),
  ];
  const rows: ParityRow[] = [];
  for (const file of files) {
    const reference = await elementPixels(file);
    const bitmap = await decodeImageOntoCanvas(file, 4096, snapshotCanvas);
    const size = [bitmap.width, bitmap.height] as const;
    rows.push({
      name: file.name,
      size,
      differingBytes: differingBytes(reference, readBack(bitmap)),
      decodedAsBitmap: decoded.has(file),
    });
  }
  return rows;
}
