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

// ─── PUBLIC TYPES ────────────────────────────────────────────────

/**
 * A single burn segment within one scanline row.
 * Coordinates are in world space (mm).
 */
export interface RasterSegment {
  startX: number;   // mm, world coordinate
  endX: number;     // mm, world coordinate
  y: number;        // mm, world coordinate
  power: number;    // 0–100%
}

/**
 * One complete scanline row, containing zero or more burn segments.
 */
export interface RasterScanline {
  y: number;                    // mm, world coordinate
  segments: RasterSegment[];
  direction: 'ltr' | 'rtl';    // left-to-right or right-to-left
}

export interface RasterSettings {
  powerMin: number;        // 0–100%, maps to pixel value 1
  powerMax: number;        // 0–100%, maps to pixel value 255
  speed: number;           // mm/min
  biDirectional: boolean;
  overscanning: number;    // mm extension beyond segment boundaries
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
  const { width, height, data, mode, position, physicalWidth, physicalHeight } = bitmap;
  if (width === 0 || height === 0 || data.length === 0) return [];

  /** Pixel pitch from actual physical size (matches resampled bitmap; avoids dpi-only mismatch). */
  const pixelSizeX = physicalWidth / width;
  const pixelSizeY = physicalHeight / height;
  if (!(pixelSizeX > 0) || !(pixelSizeY > 0)) return [];

  const scanlines: RasterScanline[] = [];
  let lineIndex = 0;

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
      settings.biDirectional && lineIndex % 2 === 1 ? 'rtl' : 'ltr';

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

    scanlines.push({ y, segments, direction });
    lineIndex++;
  }

  return scanlines;
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
        settings.powerMax, settings.overscanning
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
 * Variable-power row: each pixel gets S = luminanceToLaserPower; adjacent equal S merge.
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

  const flush = (endCol: number) => {
    if (segStart === null || currentPower <= 0) {
      segStart = null;
      currentPower = -1;
      return;
    }
    segments.push(createSegment(
      segStart, endCol, y, originX, pixelSizeMm,
      currentPower, settings.overscanning,
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
    } else if (S !== currentPower) {
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
function createSegment(
  colStart: number,
  colEnd: number,
  y: number,
  originX: number,
  pixelSizeMm: number,
  power: number,
  overscanning: number
): RasterSegment {
  const startX = originX + colStart * pixelSizeMm - overscanning;
  const endX = originX + colEnd * pixelSizeMm + overscanning;
  return { startX, endX, y, power };
}

