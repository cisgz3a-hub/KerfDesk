import type { IncrementalPngHeaderResult } from './png-incremental-decoder';

type HeightfieldRows = {
  readonly samples: Uint8Array;
  readonly inclusionMask?: Uint8Array;
};

type SourceLayout = 'grayscale-u8' | 'grayscale-u16' | 'grayscale-alpha-u8';

/** Accumulate exact PNG rows into canonical U16LE samples and an optional U8 mask. */
export type PngHeightfieldRowAccumulator = {
  readonly acceptHeader: (header: IncrementalPngHeaderResult) => void;
  readonly acceptRow: (row: Uint8Array) => void;
  readonly complete: () => HeightfieldRows | null;
};

/** Build one bounded accumulator for a qualified exact heightfield decode. */
export function createPngHeightfieldRowAccumulator(): PngHeightfieldRowAccumulator {
  let samples: Uint8Array | null = null;
  let inclusionMask: Uint8Array | undefined;
  let sampleOffset = 0;
  let layout: SourceLayout | null = null;
  return {
    acceptHeader: (header) => {
      const allocation = allocateHeightfieldRows(header);
      samples = allocation.samples;
      inclusionMask = allocation.inclusionMask;
      layout = allocation.layout;
    },
    acceptRow: (row) => {
      if (samples === null || layout === null) {
        throw new Error('Height-map PNG produced inconsistent sample rows.');
      }
      sampleOffset = appendHeightfieldRow(samples, inclusionMask, sampleOffset, row, layout);
    },
    complete: () => {
      if (samples === null || sampleOffset * 2 !== samples.byteLength) return null;
      return inclusionMask === undefined ? { samples } : { samples, inclusionMask };
    },
  };
}

function allocateHeightfieldRows(header: IncrementalPngHeaderResult): HeightfieldRows & {
  readonly layout: SourceLayout;
} {
  const layout = sourceLayout(header);
  const sampleCount = header.width * header.height;
  const sampleBytes = sampleCount * 2;
  if (!Number.isSafeInteger(sampleBytes)) {
    throw new Error('Canonical height-map sample bytes exceed the exact numeric range.');
  }
  const samples = allocateCanonicalSamples(sampleBytes);
  return layout === 'grayscale-alpha-u8'
    ? { samples, inclusionMask: allocateInclusionMask(sampleCount), layout }
    : { samples, layout };
}

function allocateCanonicalSamples(sampleBytes: number): Uint8Array {
  try {
    return new Uint8Array(sampleBytes);
  } catch {
    throw new Error('Canonical height-map samples do not fit in this runtime.');
  }
}

function allocateInclusionMask(sampleCount: number): Uint8Array {
  try {
    return new Uint8Array(sampleCount);
  } catch {
    throw new Error('Canonical height-map inclusion mask does not fit in this runtime.');
  }
}

function sourceLayout(header: IncrementalPngHeaderResult): SourceLayout {
  if (header.sampledWidth !== header.width || header.sampledHeight !== header.height) {
    throw new Error('Height-map dimensions exceed the exact sample range.');
  }
  if (header.colorType === 0 && header.bitDepth === 8) return 'grayscale-u8';
  if (header.colorType === 0 && header.bitDepth === 16) return 'grayscale-u16';
  if (header.colorType === 4 && header.bitDepth === 8) return 'grayscale-alpha-u8';
  throw new Error('Height maps must be non-interlaced 8- or 16-bit grayscale PNG files.');
}

function appendHeightfieldRow(
  samples: Uint8Array,
  inclusionMask: Uint8Array | undefined,
  initialSampleOffset: number,
  row: Uint8Array,
  layout: SourceLayout,
): number {
  const sourceBytesPerPixel = layout === 'grayscale-u8' ? 1 : 2;
  const rowSamples = row.byteLength / sourceBytesPerPixel;
  if (
    !Number.isInteger(rowSamples) ||
    (initialSampleOffset + rowSamples) * 2 > samples.byteLength
  ) {
    throw new Error('Height-map PNG produced inconsistent sample rows.');
  }
  let sampleOffset = initialSampleOffset;
  for (let index = 0; index < row.byteLength; index += sourceBytesPerPixel) {
    writeCanonicalSample(samples, inclusionMask, sampleOffset, row, index, layout);
    sampleOffset += 1;
  }
  return sampleOffset;
}

function writeCanonicalSample(
  samples: Uint8Array,
  inclusionMask: Uint8Array | undefined,
  sampleOffset: number,
  row: Uint8Array,
  sourceOffset: number,
  layout: SourceLayout,
): void {
  const first = row[sourceOffset] ?? 0;
  const second = row[sourceOffset + 1] ?? first;
  samples[sampleOffset * 2] = layout === 'grayscale-u16' ? second : first;
  samples[sampleOffset * 2 + 1] = first;
  if (layout === 'grayscale-alpha-u8') {
    if (inclusionMask === undefined) {
      throw new Error('Height-map PNG produced inconsistent alpha rows.');
    }
    inclusionMask[sampleOffset] = second;
  }
}
