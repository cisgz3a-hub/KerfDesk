import { throwIfAborted } from './png-stream-reader';

/** Byte layout needed to reconstruct one non-interlaced PNG image stream. */
export type PngFilteredRowLayout = {
  readonly height: number;
  readonly rowBytes: number;
  readonly bytesPerPixel: number;
};

/** Reconstruct exact PNG scanline bytes while retaining only two source rows. */
export async function consumePngFilteredRows(
  readable: ReadableStream<Uint8Array>,
  layout: PngFilteredRowLayout,
  signal: AbortSignal | undefined,
  onRow: (row: Uint8Array, sourceY: number) => void | Promise<void>,
): Promise<void> {
  const bytes = new StreamBytes(readable.getReader(), signal);
  let previous = new Uint8Array(layout.rowBytes);
  let current = new Uint8Array(layout.rowBytes);
  for (let sourceY = 0; sourceY < layout.height; sourceY += 1) {
    throwIfAborted(signal);
    const filter = await bytes.readByte();
    await bytes.readInto(current);
    unfilter(current, previous, layout.bytesPerPixel, filter);
    await onRow(current, sourceY);
    [previous, current] = [current, previous];
  }
  await bytes.expectEnd();
}

class StreamBytes {
  private current: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private offset = 0;

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly signal?: AbortSignal,
  ) {}

  async readByte(): Promise<number> {
    await this.ensureCurrent();
    const value = this.current[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  async readInto(target: Uint8Array): Promise<void> {
    let written = 0;
    while (written < target.length) {
      await this.ensureCurrent();
      const take = Math.min(target.length - written, this.current.length - this.offset);
      target.set(this.current.subarray(this.offset, this.offset + take), written);
      this.offset += take;
      written += take;
    }
  }

  async expectEnd(): Promise<void> {
    if (this.offset < this.current.length) throw new Error('PNG decompressed data is too long.');
    const tail = await this.reader.read();
    if (tail.done !== true && tail.value.length > 0) {
      throw new Error('PNG decompressed data is too long.');
    }
  }

  private async ensureCurrent(): Promise<void> {
    while (this.offset >= this.current.length) {
      throwIfAborted(this.signal);
      const next = await this.reader.read();
      if (next.done === true) throw new Error('PNG decompressed data ended before the final row.');
      if (next.value.length === 0) continue;
      this.current = next.value;
      this.offset = 0;
    }
  }
}

function unfilter(
  row: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  filter: number,
): void {
  if (filter > 4) throw new Error(`Unknown PNG filter ${filter}.`);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? (row[index - bytesPerPixel] ?? 0) : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0;
    row[index] = ((row[index] ?? 0) + predictor(filter, left, up, upLeft)) & 0xff;
  }
}

function predictor(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  return paeth(left, up, upLeft);
}

function paeth(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const diagonalDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
  return upDistance <= diagonalDistance ? up : upLeft;
}
