// A typed column that grows without copying what it holds (ADR-244
// Amendment 2), like the parser's segment chunks (segment-builder.ts): the
// first chunk doubles up to CHUNK values, so a short column stays small, and
// whole chunks are added after it.

const CHUNK_BITS = 14;
const CHUNK = 1 << CHUNK_BITS;
const OFFSET_MASK = CHUNK - 1;
const FIRST_CHUNK = 256;

type TypedColumn = Float64Array | Uint32Array | Uint8Array;

export class ChunkedColumn<T extends TypedColumn> {
  private readonly chunks: T[] = [];
  private size = 0;

  constructor(private readonly create: (length: number) => T) {}

  get length(): number {
    return this.size;
  }

  push(value: number): void {
    const index = this.size;
    const chunkIndex = index >>> CHUNK_BITS;
    const offset = index & OFFSET_MASK;
    let chunk = this.chunks[chunkIndex];
    if (chunk === undefined) {
      chunk = this.create(chunkIndex === 0 ? FIRST_CHUNK : CHUNK);
      this.chunks.push(chunk);
    } else if (offset >= chunk.length) {
      const grown = this.create(Math.min(CHUNK, chunk.length * 2));
      grown.set(chunk);
      chunk = grown;
      this.chunks[chunkIndex] = grown;
    }
    chunk[offset] = value;
    this.size += 1;
  }

  get(index: number): number {
    return this.chunks[index >>> CHUNK_BITS]?.[index & OFFSET_MASK] ?? 0;
  }

  /** Overwrites a value already pushed. */
  set(index: number, value: number): void {
    const chunk = this.chunks[index >>> CHUNK_BITS];
    if (chunk !== undefined && index < this.size) chunk[index & OFFSET_MASK] = value;
  }
}
