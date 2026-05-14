/**
 * === FILE: /src/core/plan/RasterGenerator.ts ===
 *
 * Purpose:    Converts a ProcessedBitmap into raster scanline segments
 *             for image engraving. Handles two pixel modes:
 *
 *             1-bit:  Pixels are ON or OFF. Consecutive ON pixels
 *                     become burn segments at constant power.
 *
 *             Grayscale: 8-bit luminance (0 = dark, 255 = light). Each pixel maps to
 *                     laser power; consecutive pixels with the same rounded S are merged
 *                     into one G1 span (LaserGRBL-style variable power).
 *
 *             For both modes, empty rows are skipped, segments are
 *             run-length encoded, and bidirectional scanning alternates
 *             direction per row.
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/job/Job.ts (ProcessedBitmap)
 * Last updated: Phase 5, Step 18d — Raster scanline generation
 */

import { type ProcessedBitmap } from '../job/Job';
import { darknessToPower, type ResponseCurve } from '../materials/ResponseCurve';

export const DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE = 2;

// ─── PUBLIC TYPES ────────────────────────────────────────────────

/**
 * A single burn segment within one scanline row.
 * Coordinates are in world space (mm).
 *
 * T1-173 (audit Critical #1): `startX` and `endX` are now the pure
 * ARTWORK pixel bounds — the range where the laser fires at `power`.
 * Pre-T1-173 these fields silently included `±overscanning`, which
 * caused `planRasterOperation` to burn the overscan region at full
 * power and engrave outside the intended image. The overscan-travel
 * envelope now lives at the scanline level (see `RasterScanline`)
 * and is emitted as G1 S0 motion by the planner, mirroring the
 * existing-and-correct fill pattern.
 *
 * For LTR rows: `startX < endX` (left edge of first burn pixel to
 * right edge of last burn pixel in this segment).
 *
 * For RTL rows: `startX > endX` (the segment is reversed AFTER
 * generation so the burn-on point is `startX` and burn-off is `endX`,
 * matching machine motion direction).
 */
export interface RasterSegment {
  startX: number;   // mm, world coordinate, burn START (laser on point)
  endX: number;     // mm, world coordinate, burn END (laser off point)
  y: number;        // mm, world coordinate
  power: number;    // 0–100%
}

/**
 * One complete scanline row, containing zero or more burn segments.
 *
 * T1-173 (audit Critical #1): added `overscanFromX` / `overscanToX`
 * — the row's travel envelope for acceleration/deceleration. The
 * machine ENTERS the scanline at `overscanFromX` (G0 rapid), travels
 * to the first segment's `startX` with G1 S0 (laser off, machine
 * accelerates to scan speed), burns the segments, then travels from
 * the last segment's `endX` to `overscanToX` with G1 S0 (laser off,
 * machine decelerates). This mirrors the existing-and-correct
 * `FillScanlineRow.overscanFrom` / `overscanTo` pattern.
 */
export interface RasterScanline {
  y: number;                    // mm, world coordinate
  segments: RasterSegment[];
  direction: 'ltr' | 'rtl';    // left-to-right or right-to-left
  /**
   * T1-173: row's overscan-from X. For LTR: leftmost burn-start
   * minus `overscanning`. For RTL: rightmost burn-start plus
   * `overscanning`. (For RTL the segments are reversed so the
   * "first" segment's `startX` is the rightmost burn-start.)
   * Equal to `firstSegment.startX` when `overscanning === 0`.
   */
  overscanFromX: number;
  /**
   * T1-173: row's overscan-to X. For LTR: rightmost burn-end plus
   * `overscanning`. For RTL: leftmost burn-end minus `overscanning`.
   * Equal to `lastSegment.endX` when `overscanning === 0`.
   */
  overscanToX: number;
}

export interface RasterSettings {
  powerMin: number;        // 0–100%, maps to pixel value 1
  powerMax: number;        // 0–100%, maps to pixel value 255
  speed: number;           // mm/min
  biDirectional: boolean;
  overscanning: number;    // mm extension beyond segment boundaries
  /** Grayscale mode: merge adjacent spans whose power differs by this many percentage points or less. */
  grayscalePowerMergeTolerance?: number;
  responseCurve?: ResponseCurve;
}

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Convert a ProcessedBitmap into raster scanlines.
 *
 * Each row of pixels becomes zero or more RasterSegments.
 * Empty rows (all zero pixels) are skipped entirely.
 * Bidirectional mode alternates scan direction per row.
 * Overscanning extends segments beyond boundaries.
 *
 * Returns only non-empty scanlines in top-to-bottom order.
 */
export function generateRasterScanlines(
  bitmap: ProcessedBitmap,
  settings: RasterSettings
): RasterScanline[] {
  return Array.from(iterateRasterScanlines(bitmap, settings));
}

/**
 * T3-34 first slice: lazily produce raster scanlines row-by-row.
 *
 * This does not yet stream final G-code chunks (that still depends on
 * the broader T3-15 spool migration), but it removes the eager
 * `RasterScanline[]` materialization from the planner path so large
 * rasters can release each source row as soon as its moves are appended.
 */
export function* iterateRasterScanlines(
  bitmap: ProcessedBitmap,
  settings: RasterSettings
): Generator<RasterScanline, void, void> {
  const { width, height, data, mode, position, physicalWidth, physicalHeight } = bitmap;
  if (width === 0 || height === 0 || data.length === 0) return;

  /** Pixel pitch from actual physical size (matches resampled bitmap; avoids dpi-only mismatch). */
  const pixelSizeX = physicalWidth / width;
  const pixelSizeY = physicalHeight / height;
  if (!(pixelSizeX > 0) || !(pixelSizeY > 0)) return;

  for (let row = 0; row < height; row++) {
    const y = position.y + row * pixelSizeY;
    const rowStart = row * width;

    // Extract burn segments from this row
    const segments = mode === '1bit'
      ? extractSegments1Bit(data, rowStart, width, y, position.x, pixelSizeX, settings)
      : extractSegmentsGrayscale(data, rowStart, width, y, position.x, pixelSizeX, settings);

    // Skip empty rows
    if (segments.length === 0) continue;

    // Determine direction
    const direction: 'ltr' | 'rtl' =
      settings.biDirectional && row % 2 === 1 ? 'rtl' : 'ltr';

    // Reverse segment order for right-to-left
    if (direction === 'rtl') {
      segments.reverse();
      // Also swap startX/endX within each segment
      for (const seg of segments) {
        const tmp = seg.startX;
        seg.startX = seg.endX;
        seg.endX = tmp;
      }
    }

    // T1-173 (audit Critical #1): compute the row's overscan-travel
    // envelope. The machine enters at `overscanFromX` (G0 rapid),
    // approaches the first burn pixel with G1 S0, burns the segments,
    // then decelerates from the last burn pixel to `overscanToX` with
    // G1 S0. Pre-T1-173 this envelope was baked into per-segment
    // `startX`/`endX` and engraved at full power. For LTR the envelope
    // extends leftward at the start and rightward at the end; for RTL
    // the directions are mirrored because the first/last segments'
    // startX/endX have been swapped above.
    const overscan = settings.overscanning;
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const overscanFromX = direction === 'ltr'
      ? firstSeg.startX - overscan
      : firstSeg.startX + overscan;
    const overscanToX = direction === 'ltr'
      ? lastSeg.endX + overscan
      : lastSeg.endX - overscan;

    yield { y, segments, direction, overscanFromX, overscanToX };
  }
}

// ─── 1-BIT SEGMENT EXTRACTION ────────────────────────────────────

/**
 * Extract burn segments from a 1-bit row.
 * ON pixels (value > 0) become burn segments at constant power.
 * Consecutive ON pixels are grouped into one segment.
 */
function extractSegments1Bit(
  data: Uint8Array,
  rowStart: number,
  width: number,
  y: number,
  originX: number,
  pixelSizeMm: number,
  settings: RasterSettings
): RasterSegment[] {
  const segments: RasterSegment[] = [];
  let segStart: number | null = null;

  for (let col = 0; col <= width; col++) {
    const isOn = col < width && data[rowStart + col] > 0;

    if (isOn && segStart === null) {
      // Start of a new segment
      segStart = col;
    } else if (!isOn && segStart !== null) {
      // End of current segment
      segments.push(createSegment(
        segStart, col, y, originX, pixelSizeMm,
        settings.powerMax,
      ));
      segStart = null;
    }
  }

  return segments;
}

// ─── GRAYSCALE (VARIABLE S) SEGMENT EXTRACTION ───────────────────

/** Map luminance 0–255 (dark→light) to laser power %; white → powerMin, black → powerMax. */
export function luminanceToLaserPower(
  pixelValue: number,
  powerMin: number,
  powerMax: number,
  responseCurve?: ResponseCurve,
): number {
  const v = Math.max(0, Math.min(255, pixelValue));
  const darknessNormalized = 1 - v / 255;
  if (responseCurve) {
    const mapped = darknessToPower(responseCurve, darknessNormalized);
    return Math.round(Math.max(powerMin, Math.min(powerMax, mapped)));
  }
  return Math.round(powerMin + (powerMax - powerMin) * darknessNormalized);
}

/**
 * Variable-power row: each pixel gets S = luminanceToLaserPower; adjacent near-equal S merge.
 * Pixels with S <= 0 are treated as laser off (skip).
 */
function extractSegmentsGrayscale(
  data: Uint8Array,
  rowStart: number,
  width: number,
  y: number,
  originX: number,
  pixelSizeMm: number,
  settings: RasterSettings
): RasterSegment[] {
  const segments: RasterSegment[] = [];
  let segStart: number | null = null;
  let currentPower = -1;
  const mergeTolerance = normalizeGrayscalePowerMergeTolerance(settings.grayscalePowerMergeTolerance);

  const flush = (endCol: number) => {
    if (segStart === null || currentPower <= 0) {
      segStart = null;
      currentPower = -1;
      return;
    }
    segments.push(createSegment(
      segStart, endCol, y, originX, pixelSizeMm,
      currentPower,
    ));
    segStart = null;
    currentPower = -1;
  };

  for (let col = 0; col < width; col++) {
    const lum = data[rowStart + col];
    const S = luminanceToLaserPower(
      lum,
      settings.powerMin,
      settings.powerMax,
      settings.responseCurve,
    );

    if (S <= 0) {
      flush(col);
      continue;
    }
    if (segStart === null) {
      segStart = col;
      currentPower = S;
    } else if (Math.abs(S - currentPower) > mergeTolerance) {
      flush(col);
      segStart = col;
      currentPower = S;
    }
  }
  flush(width);

  return segments;
}

// ─── HELPERS ─────────────────────────────────────────────────────

/**
 * Create a RasterSegment from pixel column indices.
 */
function normalizeGrayscalePowerMergeTolerance(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GRAYSCALE_POWER_MERGE_TOLERANCE;
  }
  return Math.max(0, Math.min(100, value));
}

function createSegment(
  colStart: number,
  colEnd: number,
  y: number,
  originX: number,
  pixelSizeMm: number,
  power: number,
): RasterSegment {
  // T1-173 (audit Critical #1): segments now contain PURE artwork
  // pixel bounds. Pre-T1-173 the function added `-overscanning` /
  // `+overscanning` here, which propagated into `appendRasterBurnMoves`
  // in `planRasterOperation` and engraved the overscan region at full
  // power. The overscan envelope is now computed per-scanline (see
  // `generateRasterScanlines` → `overscanFromX` / `overscanToX`) and
  // emitted as G1 S0 travel.
  const startX = originX + colStart * pixelSizeMm;
  const endX = originX + colEnd * pixelSizeMm;
  return { startX, endX, y, power };
}

