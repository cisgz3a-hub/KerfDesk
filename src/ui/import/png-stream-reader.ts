export class PngStreamReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private current: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private offset = 0;
  private consumed = 0;

  constructor(
    chunks: AsyncIterable<Uint8Array>,
    private readonly signal?: AbortSignal,
    private readonly onBytes?: (encodedBytes: number) => void,
  ) {
    this.iterator = chunks[Symbol.asyncIterator]();
  }

  get encodedBytes(): number {
    return this.consumed;
  }

  async readExact(length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    let written = 0;
    await this.readSegments(length, (segment) => {
      result.set(segment, written);
      written += segment.length;
    });
    return result;
  }

  async readUint32(): Promise<number> {
    const bytes = await this.readExact(4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  }

  async readSegments(
    length: number,
    visit: (segment: Uint8Array) => void | Promise<void>,
  ): Promise<void> {
    let remaining = length;
    while (remaining > 0) {
      throwIfAborted(this.signal);
      await this.ensureCurrent();
      const available = this.current.length - this.offset;
      const take = Math.min(available, remaining);
      const segment = this.current.subarray(this.offset, this.offset + take);
      await visit(segment);
      this.offset += take;
      remaining -= take;
      this.consumed += take;
      this.onBytes?.(this.consumed);
    }
  }

  private async ensureCurrent(): Promise<void> {
    while (this.offset >= this.current.length) {
      throwIfAborted(this.signal);
      const next = await this.iterator.next();
      if (next.done === true) throw new Error('Unexpected end of PNG data.');
      if (next.value.length === 0) continue;
      this.current = next.value;
      this.offset = 0;
    }
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('PNG decode cancelled');
  error.name = 'AbortError';
  throw error;
}

export { finishPngCrc, startPngCrc, updatePngCrc } from '../../io/raster-decode/png-crc';
