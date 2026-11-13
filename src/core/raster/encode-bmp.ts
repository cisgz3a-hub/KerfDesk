// A minimal 24-bit BMP encoder for exporting image pixels (LightBurn File >
// Export unprocessed image as BMP). Browsers encode PNG and JPEG natively but
// not BMP. Rows are written bottom-up and padded to four bytes; alpha is
// composited onto white so transparent areas stay paper-coloured.

const FILE_HEADER_BYTES = 14;
const INFO_HEADER_BYTES = 40;
const PIXEL_OFFSET = FILE_HEADER_BYTES + INFO_HEADER_BYTES;
const BYTES_PER_PIXEL = 3;
const INCH_PER_METRE = 0.0254;

export function encodeBmp24(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dpi = 96,
): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('A BMP needs a whole-pixel width and height of at least 1.');
  }
  if (rgba.length < width * height * 4)
    throw new Error('The pixel buffer is shorter than the image.');
  const stride = Math.ceil((width * BYTES_PER_PIXEL) / 4) * 4;
  const bytes = new Uint8Array(PIXEL_OFFSET + stride * height);
  writeHeaders(new DataView(bytes.buffer), bytes.length, width, height, stride * height, dpi);
  for (let y = 0; y < height; y += 1) {
    writeRow(bytes, rgba, PIXEL_OFFSET + (height - 1 - y) * stride, y * width * 4, width);
  }
  return bytes;
}

function writeHeaders(
  view: DataView,
  fileBytes: number,
  width: number,
  height: number,
  pixelBytes: number,
  dpi: number,
): void {
  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  view.setUint32(2, fileBytes, true);
  view.setUint32(10, PIXEL_OFFSET, true);
  view.setUint32(14, INFO_HEADER_BYTES, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  const perMetre = Math.round(dpi / INCH_PER_METRE);
  view.setInt32(38, perMetre, true);
  view.setInt32(42, perMetre, true);
}

function writeRow(
  bytes: Uint8Array,
  rgba: Uint8ClampedArray | Uint8Array,
  rowStart: number,
  sourceStart: number,
  width: number,
): void {
  for (let x = 0; x < width; x += 1) {
    const source = sourceStart + x * 4;
    const alpha = (rgba[source + 3] as number) / 255;
    const target = rowStart + x * BYTES_PER_PIXEL;
    bytes[target] = composite(rgba[source + 2] as number, alpha);
    bytes[target + 1] = composite(rgba[source + 1] as number, alpha);
    bytes[target + 2] = composite(rgba[source] as number, alpha);
  }
}

function composite(channel: number, alpha: number): number {
  return Math.round(channel * alpha + 255 * (1 - alpha));
}

const GREY_LEVELS = 256;
const PALETTE_BYTES = GREY_LEVELS * 4;
const GREY_PIXEL_OFFSET = PIXEL_OFFSET + PALETTE_BYTES;

/**
 * An 8-bit greyscale BMP: one byte a pixel over a 256-grey palette, a third of
 * the 24-bit size. For generated greyscale images that are embedded many
 * times, such as the squares of a Photo Test Card (ADR-711).
 */
export function encodeBmp8Grey(
  luma: Uint8Array,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('A BMP needs a whole-pixel width and height of at least 1.');
  }
  if (luma.length < width * height) throw new Error('The pixel buffer is shorter than the image.');
  const stride = Math.ceil(width / 4) * 4;
  const bytes = new Uint8Array(GREY_PIXEL_OFFSET + stride * height);
  const view = new DataView(bytes.buffer);
  writeHeaders(view, bytes.length, width, height, stride * height, 96);
  view.setUint32(10, GREY_PIXEL_OFFSET, true);
  view.setUint16(28, 8, true);
  view.setUint32(46, GREY_LEVELS, true);
  for (let grey = 0; grey < GREY_LEVELS; grey += 1) {
    bytes.fill(grey, PIXEL_OFFSET + grey * 4, PIXEL_OFFSET + grey * 4 + 3);
  }
  for (let y = 0; y < height; y += 1) {
    bytes.set(
      luma.subarray(y * width, (y + 1) * width),
      GREY_PIXEL_OFFSET + (height - 1 - y) * stride,
    );
  }
  return bytes;
}
