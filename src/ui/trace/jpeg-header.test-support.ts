// Synthetic JPEG headers for loader and import tests: SOI, optional JFIF
// APP0, optional XMP APP1, optional EXIF APP1 carrying Orientation, a
// baseline SOF0 frame header and the start of a scan. No image data follows;
// the header readers stop at the scan.

export type SyntheticJpegOptions = {
  readonly width: number;
  readonly height: number;
  readonly orientation?: number;
  /** The Orientation entry's value count; the specification requires 1. */
  readonly orientationCount?: number;
  readonly byteOrder?: 'II' | 'MM';
  readonly jfifDpi?: { readonly x: number; readonly y: number };
  readonly xmpBeforeExif?: boolean;
};

export function syntheticJpegBytes(options: SyntheticJpegOptions): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [0xff, 0xd8];
  if (options.jfifDpi !== undefined) {
    const { x, y } = options.jfifDpi;
    // 'JFIF\0', version 1.1, units 1 (dots per inch), X/Y density, no thumbnail.
    segment(bytes, 0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 1, ...u16be(x), ...u16be(y), 0, 0]);
  }
  if (options.xmpBeforeExif === true) {
    segment(bytes, 0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]);
  }
  if (options.orientation !== undefined) {
    segment(
      bytes,
      0xe1,
      exifPayload(options.orientation, options.byteOrder ?? 'II', options.orientationCount ?? 1),
    );
  }
  // SOF0: precision, height, width, three components.
  segment(bytes, 0xc0, [
    8,
    ...u16be(options.height),
    ...u16be(options.width),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
  segment(bytes, 0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

export function syntheticJpegFile(options: SyntheticJpegOptions, name = 'photo.jpg'): File {
  return new File([syntheticJpegBytes(options)], name, { type: 'image/jpeg' });
}

// 'Exif\0\0', then a TIFF block whose IFD0 holds Make before Orientation so
// the reader has to walk the entries rather than read a fixed offset.
function exifPayload(orientation: number, byteOrder: 'II' | 'MM', count: number): number[] {
  const little = byteOrder === 'II';
  const u16 = (value: number): number[] => (little ? u16le(value) : u16be(value));
  const u32 = (value: number): number[] => (little ? u32le(value) : u32be(value));
  const tiff = [
    ...ascii(byteOrder),
    ...u16(42),
    ...u32(8),
    ...u16(2),
    // Make: ASCII, 4 bytes, stored inline.
    ...u16(0x010f),
    ...u16(2),
    ...u32(4),
    ...ascii('Cam'),
    0,
    // Orientation: SHORT, count 1, value in the first two bytes.
    ...u16(0x0112),
    ...u16(3),
    ...u32(count),
    ...u16(orientation),
    0,
    0,
    ...u32(0),
  ];
  return [...ascii('Exif'), 0, 0, ...tiff];
}

function segment(bytes: number[], marker: number, payload: ReadonlyArray<number>): void {
  bytes.push(0xff, marker, ...u16be(payload.length + 2), ...payload);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
