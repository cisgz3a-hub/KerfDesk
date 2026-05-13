import type { CalibrationGridResult } from './CalibrationGrid';
import { generateId } from '../types';
import { type ResponseCurve, type ResponseCurvePoint, validateCurve } from './ResponseCurve';

export interface AnalyzePhotoInput {
  /** Full-photo ImageData (from canvas.getImageData). */
  photo: ImageData;
  /** ROI the user drew, in photo pixel coords. */
  roi: { x: number; y: number; width: number; height: number };
  /** Grid metadata from Step 2, passed through Step 3. */
  grid: CalibrationGridResult;
  /** Scan speed the grid was calibrated at — copied into the curve. */
  calibrationSpeed: number;
  /** Material name — copied into the curve. */
  materialName: string;
  /** Optional note. */
  note?: string;
}

export interface AnalyzePhotoResult {
  ok: true;
  curve: ResponseCurve;
  /** Per-square darkness measurements (useful for a preview/debug UI). */
  measurements: Array<{
    index: number;
    commandedPower: number;
    meanLuminance: number;    // 0..255
    observedDarkness: number; // 0..1
  }>;
}

export type AnalyzePhotoError = { ok: false; error: string };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function meanLuminanceInRect(
  image: ImageData,
  rect: { x: number; y: number; width: number; height: number },
): number | null {
  const x0 = Math.floor(rect.x);
  const y0 = Math.floor(rect.y);
  const x1 = Math.ceil(rect.x + rect.width);
  const y1 = Math.ceil(rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return null;

  let sum = 0;
  let count = 0;
  const w = image.width;
  const h = image.height;
  for (let y = y0; y < y1; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= w) continue;
      const i = (y * w + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

export function analyzeCalibrationPhoto(
  input: AnalyzePhotoInput,
): AnalyzePhotoResult | AnalyzePhotoError {
  const { photo, roi, grid, calibrationSpeed, materialName, note } = input;
  if (grid.squares.length < 3) return { ok: false, error: 'Calibration grid has fewer than 3 squares.' };
  if (roi.width <= 0 || roi.height <= 0) return { ok: false, error: 'ROI must have positive width and height.' };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sq of grid.squares) {
    minX = Math.min(minX, sq.bounds.x);
    minY = Math.min(minY, sq.bounds.y);
    maxX = Math.max(maxX, sq.bounds.x + sq.bounds.width);
    maxY = Math.max(maxY, sq.bounds.y + sq.bounds.height);
  }
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  if (worldW <= 0 || worldH <= 0) return { ok: false, error: 'Invalid grid world bounds.' };

  const measurements: AnalyzePhotoResult['measurements'] = [];
  for (const sq of grid.squares) {
    const u = (sq.bounds.x - minX) / worldW;
    const v = (sq.bounds.y - minY) / worldH;
    const u2 = (sq.bounds.x + sq.bounds.width - minX) / worldW;
    const v2 = (sq.bounds.y + sq.bounds.height - minY) / worldH;

    const pxRect = {
      x: roi.x + u * roi.width,
      y: roi.y + v * roi.height,
      width: (u2 - u) * roi.width,
      height: (v2 - v) * roi.height,
    };

    const insetX = pxRect.width * 0.2;
    const insetY = pxRect.height * 0.2;
    const innerRect = {
      x: pxRect.x + insetX,
      y: pxRect.y + insetY,
      width: pxRect.width - insetX * 2,
      height: pxRect.height - insetY * 2,
    };

    const lum = meanLuminanceInRect(photo, innerRect);
    if (lum == null) continue;
    const observedDarkness = clamp(1 - lum / 255, 0, 1);
    measurements.push({
      index: sq.index,
      commandedPower: sq.commandedPower,
      meanLuminance: lum,
      observedDarkness,
    });
  }

  measurements.sort((a, b) => a.commandedPower - b.commandedPower);
  const monotonic: Array<{ index: number; point: ResponseCurvePoint }> = [];
  let lastDarkness = -Infinity;
  for (const m of measurements) {
    if (m.observedDarkness + 1e-9 < lastDarkness) {
      console.warn(
        `[CalibrationAnalyzer] Dropping non-monotonic point at index ${m.index} (power ${m.commandedPower}).`,
      );
      continue;
    }
    monotonic.push({
      index: m.index,
      point: { commandedPower: m.commandedPower, observedDarkness: m.observedDarkness },
    });
    lastDarkness = m.observedDarkness;
  }

  const points = monotonic.map(m => m.point);
  if (points.length < 3) return { ok: false, error: 'Fewer than 3 monotonic calibration points survived.' };

  const curve: ResponseCurve = {
    id: `resp_${generateId()}`,
    materialName,
    calibrationSpeed,
    points,
    calibratedAt: new Date().toISOString(),
    note,
  };

  const validation = validateCurve(curve);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, curve, measurements };
}
