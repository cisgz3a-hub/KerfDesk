export const PNG_IMPORT_THUMBNAIL_MAX_EDGE = 256;

export type PngImportThumbnail = {
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/bmp';
  readonly bytes: Uint8Array<ArrayBuffer>;
};

export class PngThumbnailBuilder {
  private readonly width: number;
  private readonly height: number;
  private readonly luma: Uint8Array<ArrayBuffer>;
  private sourceRow = 0;
  private targetRow = 0;

  constructor(
    private readonly sourceWidth: number,
    private readonly sourceHeight: number,
    maxEdge = PNG_IMPORT_THUMBNAIL_MAX_EDGE,
  ) {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    this.width = Math.max(1, Math.round(sourceWidth * scale));
    this.height = Math.max(1, Math.round(sourceHeight * scale));
    this.luma = new Uint8Array(this.width * this.height);
  }

  accept(row: Uint8Array): void {
    if (row.byteLength !== this.sourceWidth) {
      throw new Error(
        `PNG thumbnail row has ${row.byteLength} bytes; expected ${this.sourceWidth}.`,
      );
    }
    while (
      this.targetRow < this.height &&
      sourceIndex(this.targetRow, this.height, this.sourceHeight) === this.sourceRow
    ) {
      const offset = this.targetRow * this.width;
      for (let x = 0; x < this.width; x += 1) {
        this.luma[offset + x] = row[sourceIndex(x, this.width, this.sourceWidth)] ?? 255;
      }
      this.targetRow += 1;
    }
    this.sourceRow += 1;
  }

  finish(): PngImportThumbnail {
    if (this.sourceRow !== this.sourceHeight || this.targetRow !== this.height) {
      throw new Error(
        `PNG thumbnail received ${this.sourceRow} rows and produced ${this.targetRow}; expected ${this.sourceHeight} and ${this.height}.`,
      );
    }
    return {
      width: this.width,
      height: this.height,
      mimeType: 'image/bmp',
      bytes: encodeGrayscaleBmp(this.luma, this.width, this.height),
    };
  }
}

function sourceIndex(targetIndex: number, targetSize: number, sourceSize: number): number {
  return Math.min(sourceSize - 1, Math.floor(((targetIndex + 0.5) * sourceSize) / targetSize));
}

function encodeGrayscaleBmp(
  luma: Uint8Array,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const headerBytes = 54;
  const result = new Uint8Array(headerBytes + pixelBytes);
  const view = new DataView(result.buffer);
  result[0] = 0x42;
  result[1] = 0x4d;
  view.setUint32(2, result.byteLength, true);
  view.setUint32(10, headerBytes, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = (height - 1 - y) * width;
    const targetOffset = headerBytes + y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const value = luma[sourceOffset + x] ?? 255;
      const pixelOffset = targetOffset + x * 3;
      result[pixelOffset] = value;
      result[pixelOffset + 1] = value;
      result[pixelOffset + 2] = value;
    }
  }
  return result;
}
