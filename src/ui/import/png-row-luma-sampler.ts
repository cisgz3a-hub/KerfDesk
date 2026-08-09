import { consumePngFilteredRows } from './png-filtered-row-reader';

// Four ulps of the compared magnitude absorbs the handful of multiply/add
// roundings in `targetY * scale` without ever spanning a whole source row.
const ROW_EDGE_TOLERANCE_ULPS = 4;

export type QualifiedPngHeader = {
  readonly width: number;
  readonly height: number;
  readonly channels: 1 | 3 | 4;
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
      sampleLumaRow(row, header, horizontal);
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

function sampleLumaRow(row: Uint8Array, header: QualifiedPngHeader, result: Float64Array): void {
  const scale = header.width / result.length;
  for (let targetX = 0; targetX < result.length; targetX += 1) {
    const start = targetX * scale;
    const end = (targetX + 1) * scale;
    let sum = 0;
    for (let sourceX = Math.floor(start); sourceX < Math.ceil(end); sourceX += 1) {
      const overlap = Math.min(end, sourceX + 1) - Math.max(start, sourceX);
      if (overlap > 0) sum += pixelLuma(row, sourceX, header.channels) * overlap;
    }
    result[targetX] = sum / scale;
  }
}

function pixelLuma(row: Uint8Array, x: number, channels: number): number {
  const offset = x * channels;
  if (channels === 1) return row[offset] ?? 0;
  const alpha = channels === 4 ? (row[offset + 3] ?? 255) : 255;
  const opacity = alpha / 255;
  const red = composite(row[offset] ?? 0, opacity);
  const green = composite(row[offset + 1] ?? 0, opacity);
  const blue = composite(row[offset + 2] ?? 0, opacity);
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
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
