// Chunked typed-array segment accumulator (ADR-255 stage 2; ADR-485). Moves
// land in chunks that are never regrown, so reading a long program never
// copies the moves already read. finish() hands back exact-size plain typed
// arrays one field at a time, letting each field's chunks go as soon as it is
// copied — the same pure seam pattern ADR-102 §2 mandates for heightmap
// meshes.

const FLOATS_PER_SEGMENT = 6;
// Chunks start small, so a short program stays small, and double up to a cap.
const FIRST_CHUNK_MOVES = 1024;
const LARGEST_CHUNK_MOVES = 65_536;

export type SegmentRecord = {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly kind: number;
  readonly motion: number;
  readonly line: number;
  readonly feed: number;
  readonly power: number;
  readonly lengthMm: number;
};

export type FinishedSegments = {
  readonly segmentCount: number;
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
  readonly segMotion: Uint8Array;
  readonly segLine: Uint32Array;
  readonly segFeed: Float32Array;
  readonly segPower: Float32Array;
  readonly segRouteEndMm: Float32Array;
  readonly segLengthMm?: Float64Array;
  readonly totalRouteMm: number;
};

/** Copies of the positions and kinds of a run of moves. */
export type SegmentRange = {
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
};

export type SegmentBuilder = {
  readonly push: (segment: SegmentRecord) => void;
  readonly count: () => number;
  /** The moves from `from` to the last one pushed, copied (ADR-485 preview). */
  readonly copyRange: (from: number) => SegmentRange;
  readonly finish: () => FinishedSegments;
};

type ChunkFields = {
  positions: Float32Array;
  segKind: Uint8Array;
  segMotion: Uint8Array;
  segLine: Uint32Array;
  segFeed: Float32Array;
  segPower: Float32Array;
  segRouteEndMm: Float32Array;
  segLengthMm: Float64Array;
};

type Chunk = {
  readonly start: number;
  readonly size: number;
  used: number;
  /** Emptied field by field as finish() copies them out. */
  readonly fields: { [K in keyof ChunkFields]?: ChunkFields[K] | undefined };
};

export function createSegmentBuilder(
  retainPreciseLengths = false,
  largestChunkMoves = LARGEST_CHUNK_MOVES,
): SegmentBuilder {
  const chunks: Chunk[] = [];
  let current: { chunk: Chunk; fields: ChunkFields } | null = null;
  let count = 0;
  let routeMm = 0;
  let finished: FinishedSegments | null = null;

  const push = (segment: SegmentRecord): void => {
    if (current === null || current.chunk.used === current.chunk.size) {
      const size = Math.min(largestChunkMoves, FIRST_CHUNK_MOVES * 2 ** chunks.length);
      const fields = createFields(Math.max(1, size), retainPreciseLengths);
      current = { chunk: { start: count, size: Math.max(1, size), used: 0, fields }, fields };
      chunks.push(current.chunk);
    }
    const { chunk, fields } = current;
    const at = chunk.used;
    const base = at * FLOATS_PER_SEGMENT;
    fields.positions[base] = segment.x0;
    fields.positions[base + 1] = segment.y0;
    fields.positions[base + 2] = segment.z0;
    fields.positions[base + 3] = segment.x1;
    fields.positions[base + 4] = segment.y1;
    fields.positions[base + 5] = segment.z1;
    fields.segKind[at] = segment.kind;
    fields.segMotion[at] = segment.motion;
    fields.segLine[at] = segment.line;
    fields.segFeed[at] = segment.feed;
    fields.segPower[at] = segment.power;
    if (retainPreciseLengths) fields.segLengthMm[at] = segment.lengthMm;
    routeMm += segment.lengthMm;
    fields.segRouteEndMm[at] = routeMm;
    chunk.used += 1;
    count += 1;
  };

  const copyRange = (from: number): SegmentRange => {
    const start = Math.min(count, Math.max(0, from));
    return {
      positions: copyField(chunks, 'positions', FLOATS_PER_SEGMENT, start, count),
      segKind: copyField(chunks, 'segKind', 1, start, count),
    };
  };

  const finish = (): FinishedSegments => {
    current = null;
    finished ??= {
      segmentCount: count,
      // Largest first, so the peak is the chunks plus the positions.
      positions: gather(chunks, 'positions', FLOATS_PER_SEGMENT, count),
      ...(retainPreciseLengths
        ? { segLengthMm: gather(chunks, 'segLengthMm', 1, count) }
        : dropField(chunks, 'segLengthMm')),
      segKind: gather(chunks, 'segKind', 1, count),
      segMotion: gather(chunks, 'segMotion', 1, count),
      segLine: gather(chunks, 'segLine', 1, count),
      segFeed: gather(chunks, 'segFeed', 1, count),
      segPower: gather(chunks, 'segPower', 1, count),
      segRouteEndMm: gather(chunks, 'segRouteEndMm', 1, count),
      totalRouteMm: routeMm,
    };
    return finished;
  };

  return { push, count: () => count, copyRange, finish };
}

// A builder that does not keep precise lengths gets an empty length array.
function createFields(size: number, retainPreciseLengths: boolean): ChunkFields {
  return {
    positions: new Float32Array(size * FLOATS_PER_SEGMENT),
    segKind: new Uint8Array(size),
    segMotion: new Uint8Array(size),
    segLine: new Uint32Array(size),
    segFeed: new Float32Array(size),
    segPower: new Float32Array(size),
    segRouteEndMm: new Float32Array(size),
    segLengthMm: new Float64Array(retainPreciseLengths ? size : 0),
  };
}

type FieldArray = ChunkFields[keyof ChunkFields];

const FIELD_ARRAY: { readonly [K in keyof ChunkFields]: new (length: number) => ChunkFields[K] } = {
  positions: Float32Array,
  segKind: Uint8Array,
  segMotion: Uint8Array,
  segLine: Uint32Array,
  segFeed: Float32Array,
  segPower: Float32Array,
  segRouteEndMm: Float32Array,
  segLengthMm: Float64Array,
};

// One exact array for one field, each chunk's array let go once copied.
function gather<K extends keyof ChunkFields>(
  chunks: ReadonlyArray<Chunk>,
  key: K,
  width: number,
  count: number,
): ChunkFields[K] {
  const target = copyField(chunks, key, width, 0, count);
  for (const chunk of chunks) chunk.fields[key] = undefined;
  return target;
}

function dropField(chunks: ReadonlyArray<Chunk>, key: keyof ChunkFields): Record<never, never> {
  for (const chunk of chunks) chunk.fields[key] = undefined;
  return {};
}

function copyField<K extends keyof ChunkFields>(
  chunks: ReadonlyArray<Chunk>,
  key: K,
  width: number,
  start: number,
  end: number,
): ChunkFields[K] {
  const out = new FIELD_ARRAY[key]((end - start) * width);
  for (const chunk of chunks) {
    const first = Math.max(start, chunk.start) - chunk.start;
    const last = Math.min(end, chunk.start + chunk.used) - chunk.start;
    const field: FieldArray | undefined = chunk.fields[key];
    if (first >= last || field === undefined) continue;
    out.set(field.subarray(first * width, last * width), (chunk.start + first - start) * width);
  }
  return out;
}
