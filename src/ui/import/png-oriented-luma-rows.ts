// The streaming PNG import's sampled luma rows, turned by the PNG's eXIf
// Orientation (ADR-404 Amendment 1). Chromium shows a PNG turned, and the
// image-element import sizes and decodes it turned, so a PNG too large for
// that route must land the same way. The decoder yields rows on the stored
// grid. Orientation 1 passes them straight through; any other keeps the
// sampled grid (at most BURN_MAX_SOURCE_PIXELS bytes) until the last row,
// then emits it turned, row by row.

import {
  orientationSourcePixel,
  type ExifOrientation,
} from '../../io/raster-decode/exif-orientation';
import { orientedDimensions } from '../trace/jpeg-header';

export type LumaRowSink = (row: Uint8Array) => void | Promise<void>;

export class OrientedLumaRows {
  /** The turned grid the sink receives. */
  readonly width: number;
  readonly height: number;
  private readonly stored: Uint8Array | null;
  private received = 0;

  constructor(
    private readonly orientation: ExifOrientation,
    private readonly storedWidth: number,
    private readonly storedHeight: number,
    private readonly emit: LumaRowSink,
  ) {
    const turned = orientedDimensions({ width: storedWidth, height: storedHeight }, orientation);
    this.width = turned.width;
    this.height = turned.height;
    this.stored = orientation === 1 ? null : new Uint8Array(storedWidth * storedHeight);
  }

  async accept(row: Uint8Array): Promise<void> {
    if (this.stored === null) {
      await this.emit(row);
      return;
    }
    if (row.byteLength !== this.storedWidth || this.received >= this.storedHeight) {
      throw new Error(
        `PNG luma row ${this.received} does not fit the ${this.storedWidth}-pixel grid.`,
      );
    }
    this.stored.set(row, this.received * this.storedWidth);
    this.received += 1;
  }

  /** Emits the turned grid once every stored row has arrived. */
  async finish(): Promise<void> {
    const stored = this.stored;
    if (stored === null) return;
    if (this.received !== this.storedHeight) {
      throw new Error(`PNG luma received ${this.received} of ${this.storedHeight} rows.`);
    }
    for (let y = 0; y < this.height; y += 1) {
      // Along a turned row the stored index moves by a constant step.
      const first = this.storedIndex(0, y);
      const step = this.width > 1 ? this.storedIndex(1, y) - first : 0;
      const row = new Uint8Array(this.width);
      for (let x = 0; x < this.width; x += 1) row[x] = stored[first + x * step] ?? 255;
      await this.emit(row);
    }
  }

  private storedIndex(x: number, y: number): number {
    const [sx, sy] = orientationSourcePixel(
      this.orientation,
      x,
      y,
      this.storedWidth,
      this.storedHeight,
    );
    return sy * this.storedWidth + sx;
  }
}
