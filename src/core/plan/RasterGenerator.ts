/**
 * === FILE: /src/core/plan/RasterGenerator.ts ===
 *
 * Purpose:    Converts a ProcessedBitmap into raster scanline segments
 *             for image engraving. Handles two pixel modes:
 *
 *             1-bit:  Pixels are ON or OFF. Consecutive ON pixels
 *                     become burn segments at constant power.
 *
 *             8-bit:  Pixels carry grayscale intensity (0–255).
 *                     Consecutive non-zero pixels become burn segments.
 *                     Power is mapped from pixel value using
 *                     powerMin..powerMax range.
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

import { type Point } from '../types';
import { type ProcessedBitmap } from '../job/Job';

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
  const { width, height, data, mode, dpi, position } = bitmap;
  if (width === 0 || height === 0 || data.length === 0) return [];

  const pixelSizeMm = 25.4 / dpi;  // Physical size of one pixel in mm
  const scanlines: RasterScanline[] = [];
  let lineIndex = 0;

  for (let row = 0; row < height; row++) {
    const y = position.y + row * pixelSizeMm;
    const rowStart = row * width;

    // Extract burn segments from this row
    const segments = mode === '1bit'
      ? extractSegments1Bit(data, rowStart, width, y, position.x, pixelSizeMm, settings)
      : extractSegments8Bit(data, rowStart, width, y, position.x, pixelSizeMm, settings);

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

// ─── 8-BIT SEGMENT EXTRACTION ────────────────────────────────────

/**
 * Extract burn segments from an 8-bit grayscale row.
 * Non-zero pixels become burn segments with power mapped from
 * pixel intensity: 0 = skip, 1–255 = powerMin..powerMax.
 *
 * Consecutive non-zero pixels are grouped. The segment's power
 * is the MAXIMUM pixel value in the group (preserves detail).
 */
function extractSegments8Bit(
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
  let maxVal = 0;

  for (let col = 0; col <= width; col++) {
    const val = col < width ? data[rowStart + col] : 0;

    if (val > 0 && segStart === null) {
      // Start new segment
      segStart = col;
      maxVal = val;
    } else if (val > 0 && segStart !== null) {
      // Continue segment, track max intensity
      maxVal = Math.max(maxVal, val);
    } else if (val === 0 && segStart !== null) {
      // End of segment — map max pixel value to power
      const power = mapPixelToPower(maxVal, settings.powerMin, settings.powerMax);
      segments.push(createSegment(
        segStart, col, y, originX, pixelSizeMm,
        power, settings.overscanning
      ));
      segStart = null;
      maxVal = 0;
    }
  }

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

/**
 * Map a pixel value (1–255) to a laser power (powerMin–powerMax).
 * Value 0 is never passed here (filtered upstream).
 */
function mapPixelToPower(
  value: number,
  powerMin: number,
  powerMax: number
): number {
  // Linear interpolation: value 1 → powerMin, value 255 → powerMax
  const t = (value - 1) / 254;
  return powerMin + t * (powerMax - powerMin);
}
