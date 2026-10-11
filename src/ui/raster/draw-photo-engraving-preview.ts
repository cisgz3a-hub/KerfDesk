import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import { rasterScanFrame, scanToMachine } from '../../core/raster/raster-scan-frame';
import { drawMachineRasterBitmap } from '../workspace/draw-raster-preview-bitmap';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview';

/** Restore scene orientation from the compiler's machine/scan-frame pixels. */
export function drawPhotoEngravingPreview(
  canvas: HTMLCanvasElement,
  result: Extract<PhotoEngravingPreviewResult, { kind: 'ok' }>,
  device: DeviceProfile,
  lightMarks: boolean,
): void {
  const bitmap = document.createElement('canvas');
  bitmap.width = result.width;
  bitmap.height = result.height;
  const bitmapContext = bitmap.getContext('2d');
  if (bitmapContext === null) return;
  const pixels = new Uint8ClampedArray(result.rgba);
  if (lightMarks) {
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 255 - (pixels[index] ?? 0);
      pixels[index + 1] = 255 - (pixels[index + 1] ?? 0);
      pixels[index + 2] = 255 - (pixels[index + 2] ?? 0);
    }
  }
  bitmapContext.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
  const frame = rasterScanFrame(result.scanAngleDeg);
  const bounds = result.bounds;
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) => toSceneCoords(scanToMachine(frame, point), device));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const widthMm = Math.max(...corners.map((point) => point.x)) - minX;
  const heightMm = Math.max(...corners.map((point) => point.y)) - minY;
  const scale = Math.max(result.width, result.height) / Math.max(widthMm, heightMm, 0.001);
  canvas.width = Math.max(1, Math.round(widthMm * scale));
  canvas.height = Math.max(1, Math.round(heightMm * scale));
  const context = canvas.getContext('2d');
  if (context === null) return;
  // Neutral canvas material, deliberately independent of application theme.
  // eslint-disable-next-line no-restricted-syntax -- simulated material pixels, not UI chrome (ADR-047).
  context.fillStyle = lightMarks ? '#000000' : '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawMachineRasterBitmap(context, bitmap, bounds, frame, device, {
    scale,
    offsetX: -minX * scale,
    offsetY: -minY * scale,
  });
}
