import type { PngTransparentKey } from './png-chunk-metadata';
import { consumePngFilteredRows } from './png-filtered-row-reader';

// Four ulps of the compared magnitude absorbs the handful of multiply/add
// roundings in `targetY * scale` without ever spanning a whole source row.
const ROW_EDGE_TOLERANCE_ULPS = 4;
const PAPER_LUMA = 255;

export type QualifiedPngHeader = {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3 | 4;
  /**
   * The tRNS colour of a grayscale or truecolour source, read as rows arrive.
   * Chunks are still being read then, but tRNS must precede IDAT, so the key
   * is settled before the first row decodes.
   */
  readonly transparentKey?: () => PngTransparentKey | undefined;
};

export type PngSamplingTarget = {
  readonly width: number;
  readonly height: number;
};

export async function consumePngLumaRows(
  readable: ReadableStream<Uint8Array>,
  header: QualifiedPngHeader,
  target: PngSamplingTarget,
  signal: AbortSignal | undefined,
  onRow: (row: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const stride = header.width * header.channels;
  const horizontal = new Float64Array(target.width);
  const vertical = new Float64Array(target.width);
  const verticalScale = header.height / target.height;
  let targetY = 0;

  await consumePngFilteredRows(
    readable,
    { height: header.height, rowBytes: stride, bytesPerPixel: header.channels },
    signal,
    async (row, sourceY) => {
      sampleLumaRow(row, header, horizontal, header.transparentKey?.());
      targetY = await accumulateVertical(
        horizontal,
        sourceY,
        targetY,
        verticalScale,
        target.height,
        vertical,
        onRow,
      );
    },
  );
  if (targetY !== target.height) {
    throw new Error(`PNG produced ${targetY} sampled rows; expected ${target.height}.`);
  }
}

export function pngSamplingTarget(
  width: number,
  height: number,
  maxEdge: number,
  maxPixels: number,
): PngSamplingTarget {
  const edgeScale = Math.min(1, maxEdge / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function sampleLumaRow(
  row: Uint8Array,
  header: QualifiedPngHeader,
  result: Float64Array,
  transparentKey: PngTransparentKey | undefined,
): void {
  const scale = header.width / result.length;
  for (let targetX = 0; targetX < result.length; targetX += 1) {
    const start = targetX * scale;
    const end = (targetX + 1) * scale;
    let sum = 0;
    for (let sourceX = Math.floor(start); sourceX < Math.ceil(end); sourceX += 1) {
      const overlap = Math.min(end, sourceX + 1) - Math.max(start, sourceX);
      if (overlap > 0) sum += pixelLuma(row, sourceX, header.channels, transparentKey) * overlap;
    }
    result[targetX] = sum / scale;
  }
}

function pixelLuma(
  row: Uint8Array,
  x: number,
  channels: number,
  transparentKey: PngTransparentKey | undefined,
): number {
  const offset = x * channels;
  // PNG tRNS: a pixel of exactly the key colour has alpha 0, so it is paper.
  // The route only qualifies 8-bit sources, so each byte is a whole sample.
  if (transparentKey !== undefined && isKeyColour(row, offset, transparentKey)) return PAPER_LUMA;
  if (channels === 1) return row[offset] ?? 0;
  const alpha = channels === 4 ? (row[offset + 3] ?? 255) : 255;
  const opacity = alpha / 255;
  const red = composite(row[offset] ?? 0, opacity);
  const green = composite(row[offset + 1] ?? 0, opacity);
  const blue = composite(row[offset + 2] ?? 0, opacity);
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
}

function isKeyColour(row: Uint8Array, offset: number, key: PngTransparentKey): boolean {
  for (let sample = 0; sample < key.length; sample += 1) {
    if (row[offset + sample] !== key[sample]) return false;
  }
  return true;
}

function composite(channel: number, opacity: number): number {
  return Math.round(channel * opacity + 255 * (1 - opacity));
}

async function accumulateVertical(
  horizontal: Float64Array,
  sourceY: number,
  initialTargetY: number,
  scale: number,
  targetHeight: number,
  accumulator: Float64Array,
  onRow: (row: Uint8Array) => void | Promise<void>,
): Promise<number> {
  let targetY = initialTargetY;
  const sourceEnd = sourceY + 1;
  while (targetY < targetHeight) {
    const targetStart = targetY * scale;
    const targetEnd = (targetY + 1) * scale;
    const overlap = Math.min(sourceEnd, targetEnd) - Math.max(sourceY, targetStart);
    if (overlap <= 0) break;
    for (let x = 0; x < accumulator.length; x += 1) {
      accumulator[x] = (accumulator[x] ?? 0) + (horizontal[x] ?? 0) * overlap;
    }
    // Number.EPSILON is the gap between 1.0 and the next double. Row edges here
    // reach 10^3-10^5, where the real gap is millions of times larger, so adding
    // a bare Number.EPSILON is absorbed and changes nothing. On the last source
    // row, targetEnd = targetHeight * scale can land a few ulps above an
    // arithmetically equal sourceEnd, this breaks early, and the final row is
    // never emitted — consumePngLumaRows then throws on the row-count mismatch.
    // Scale the tolerance to the magnitude being compared instead.
    const rowEdgeTolerance = Math.max(
      Number.EPSILON,
      targetEnd * Number.EPSILON * ROW_EDGE_TOLERANCE_ULPS,
    );
    if (sourceEnd + rowEdgeTolerance < targetEnd) break;
    const row = new Uint8Array(accumulator.length);
    for (let x = 0; x < row.length; x += 1) {
      row[x] = Math.round((accumulator[x] ?? 0) / scale);
    }
    await onRow(row);
    accumulator.fill(0);
    targetY += 1;
  }
  return targetY;
}
