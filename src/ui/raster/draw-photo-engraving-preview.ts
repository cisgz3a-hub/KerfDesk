import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import { rasterScanFrame, scanToMachine } from '../../core/raster/raster-scan-frame';
import { drawMachineRasterBitmap } from '../workspace/draw-raster-preview-bitmap';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';
import { maxOf, minOf } from '../../core/util';

/** Simulated material colours: the untouched surface and a full mark. */
export type PhotoPreviewColours = { readonly surface: string; readonly mark: string };

// Neutral canvas material, deliberately independent of application theme.
/* eslint-disable no-restricted-syntax -- simulated material pixels, not UI chrome (ADR-047). */
const DARK_MARKS: PhotoPreviewColours = { surface: '#ffffff', mark: '#000000' };
const LIGHT_MARKS: PhotoPreviewColours = { surface: '#000000', mark: '#ffffff' };
/* eslint-enable no-restricted-syntax */

export function defaultPhotoPreviewColours(lightMarks: boolean): PhotoPreviewColours {
  return lightMarks ? LIGHT_MARKS : DARK_MARKS;
}

/** Restore scene orientation from the compiler's machine/scan-frame pixels. */
export function drawPhotoEngravingPreview(
  canvas: HTMLCanvasElement,
  result: Extract<PhotoEngravingPreviewResult, { kind: 'ok' }>,
  device: DeviceProfile,
  lightMarks: boolean,
  options: { readonly colours?: PhotoPreviewColours; readonly material?: boolean } = {},
): void {
  const bitmap = document.createElement('canvas');
  bitmap.width = result.width;
  bitmap.height = result.height;
  const bitmapContext = bitmap.getContext('2d');
  if (bitmapContext === null) return;
  const colours = options.colours ?? defaultPhotoPreviewColours(lightMarks);
  const source =
    options.material === true && result.materialRgba !== undefined
      ? result.materialRgba
      : result.rgba;
  bitmapContext.putImageData(
    new ImageData(tintMarks(source, colours), result.width, result.height),
    0,
    0,
  );
  const frame = rasterScanFrame(result.scanAngleDeg);
  const bounds = result.bounds;
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) => toSceneCoords(scanToMachine(frame, point), device));
  const minX = minOf(corners.map((point) => point.x));
  const minY = minOf(corners.map((point) => point.y));
  const widthMm = maxOf(corners.map((point) => point.x)) - minX;
  const heightMm = maxOf(corners.map((point) => point.y)) - minY;
  const scale = Math.max(result.width, result.height) / Math.max(widthMm, heightMm, 0.001);
  canvas.width = Math.max(1, Math.round(widthMm * scale));
  canvas.height = Math.max(1, Math.round(heightMm * scale));
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.fillStyle = colours.surface;
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawMachineRasterBitmap(context, bitmap, bounds, frame, device, {
    scale,
    offsetX: -minX * scale,
    offsetY: -minY * scale,
  });
}

/** Grey preview pixels (255 = no mark, 0 = full mark) blended from surface to mark colour. */
export function tintMarks(
  grey: Uint8ClampedArray,
  colours: PhotoPreviewColours,
): Uint8ClampedArray<ArrayBuffer> {
  const surface = hexRgb(colours.surface);
  const mark = hexRgb(colours.mark);
  const out = new Uint8ClampedArray(grey.length);
  for (let index = 0; index < grey.length; index += 4) {
    const t = 1 - (grey[index] ?? 255) / 255;
    out[index] = surface[0] + (mark[0] - surface[0]) * t;
    out[index + 1] = surface[1] + (mark[1] - surface[1]) * t;
    out[index + 2] = surface[2] + (mark[2] - surface[2]) * t;
    out[index + 3] = grey[index + 3] ?? 255;
  }
  return out;
}

function hexRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
