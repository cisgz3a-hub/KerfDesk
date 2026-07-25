// Growable typed-array segment accumulator (ADR-255 stage 2). Mutation is
// builder-local; finish() hands back exact-size plain typed arrays — the same
// pure seam pattern ADR-102 §2 mandates for heightmap meshes.

const FLOATS_PER_SEGMENT = 6;

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
  readonly totalRouteMm: number;
};

export type SegmentBuilder = {
  readonly push: (segment: SegmentRecord) => void;
  readonly count: () => number;
  readonly finish: () => FinishedSegments;
};

export function createSegmentBuilder(initialCapacity = 1024): SegmentBuilder {
  let capacity = Math.max(1, initialCapacity);
  let count = 0;
  let routeMm = 0;
  // Annotated as the unparameterized (ArrayBufferLike) typed-array types so
  // grow/slice results assign cleanly under TS's generic TypedArrays.
  let positions: Float32Array = new Float32Array(capacity * FLOATS_PER_SEGMENT);
  let segKind: Uint8Array = new Uint8Array(capacity);
  let segMotion: Uint8Array = new Uint8Array(capacity);
  let segLine: Uint32Array = new Uint32Array(capacity);
  let segFeed: Float32Array = new Float32Array(capacity);
  let segPower: Float32Array = new Float32Array(capacity);
  let segRouteEndMm: Float32Array = new Float32Array(capacity);

  const grow = (): void => {
    capacity *= 2;
    const nextPositions = new Float32Array(capacity * FLOATS_PER_SEGMENT);
    nextPositions.set(positions);
    positions = nextPositions;
    const growU8 = (source: Uint8Array): Uint8Array => {
      const next = new Uint8Array(capacity);
      next.set(source);
      return next;
    };
    const growU32 = (source: Uint32Array): Uint32Array => {
      const next = new Uint32Array(capacity);
      next.set(source);
      return next;
    };
    const growF32 = (source: Float32Array): Float32Array => {
      const next = new Float32Array(capacity);
      next.set(source);
      return next;
    };
    segKind = growU8(segKind);
    segMotion = growU8(segMotion);
    segLine = growU32(segLine);
    segFeed = growF32(segFeed);
    segPower = growF32(segPower);
    segRouteEndMm = growF32(segRouteEndMm);
  };

  const push = (segment: SegmentRecord): void => {
    if (count === capacity) grow();
    const base = count * FLOATS_PER_SEGMENT;
    positions[base] = segment.x0;
    positions[base + 1] = segment.y0;
    positions[base + 2] = segment.z0;
    positions[base + 3] = segment.x1;
    positions[base + 4] = segment.y1;
    positions[base + 5] = segment.z1;
    segKind[count] = segment.kind;
    segMotion[count] = segment.motion;
    segLine[count] = segment.line;
    segFeed[count] = segment.feed;
    segPower[count] = segment.power;
    routeMm += segment.lengthMm;
    segRouteEndMm[count] = routeMm;
    count += 1;
  };

  const finish = (): FinishedSegments => ({
    segmentCount: count,
    positions: positions.slice(0, count * FLOATS_PER_SEGMENT),
    segKind: segKind.slice(0, count),
    segMotion: segMotion.slice(0, count),
    segLine: segLine.slice(0, count),
    segFeed: segFeed.slice(0, count),
    segPower: segPower.slice(0, count),
    segRouteEndMm: segRouteEndMm.slice(0, count),
    totalRouteMm: routeMm,
  });

  return { push, count: () => count, finish };
}
