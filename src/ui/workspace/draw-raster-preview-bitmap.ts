// Blits the Preview's burn simulation (F.2.c, ADR-028) at its machine
// placement, and chooses how the bitmap is sampled (ADR-359 Amendment 2).
//
// Each bitmap pixel is one burn cell, or a block of cells where the preview is
// capped. Always drawn with nearest sampling, a dithered preview shimmered when
// shrunk: below about two screen pixels a cell, some cells land on two screen
// pixels, some on one and some on none, and the pattern changed at every zoom
// step. From two screen pixels a cell, nearest keeps each dot crisp. Below
// that the bitmap is smoothed, and once it is drawn below half its size it is
// read from its nearest halved copy (raster-display-levels.ts), which averages
// the dots into the tone they burn instead of skipping cells. Display only:
// the bitmap and what burns are unchanged.

import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { RasterMachineBounds } from '../../core/job';
import {
  isAlongXScan,
  scanToMachine,
  type RasterScanFrame,
} from '../../core/raster/raster-scan-frame';
import { displayLevel } from './raster-display-levels';
import type { ViewTransform } from './view-transform';

/** Screen pixels a preview cell must span each way to be drawn with nearest sampling. */
export const PREVIEW_NEAREST_MIN_CELL_PX = 2;

/** True when every bitmap pixel covers at least two screen pixels each way. */
export function previewSamplesNearest(
  drawnWidthPx: number,
  drawnHeightPx: number,
  bitmapWidth: number,
  bitmapHeight: number,
): boolean {
  const cellPx = Math.min(drawnWidthPx / bitmapWidth, drawnHeightPx / bitmapHeight);
  return cellPx >= PREVIEW_NEAREST_MIN_CELL_PX;
}

export function drawMachineRasterBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: HTMLCanvasElement,
  bounds: RasterMachineBounds,
  frame: RasterScanFrame,
  device: DeviceProfile,
  view: ViewTransform,
): void {
  // The scan, machine and scene frames only rotate, mirror and translate, so
  // the bitmap spans its bounds' size in millimetres whatever the scan angle.
  const drawnWidth = (bounds.maxX - bounds.minX) * view.scale;
  const drawnHeight = (bounds.maxY - bounds.minY) * view.scale;
  const nearest = previewSamplesNearest(drawnWidth, drawnHeight, bitmap.width, bitmap.height);
  ctx.imageSmoothingEnabled = !nearest;
  const source = nearest ? bitmap : displayLevel(bitmap, drawnWidth, drawnHeight);
  if (!isAlongXScan(frame)) {
    drawAngledRasterBitmap(ctx, source, bounds, frame, device, view);
    return;
  }
  const start = toSceneCoords({ x: bounds.minX, y: bounds.minY }, device);
  const end = toSceneCoords({ x: bounds.maxX, y: bounds.maxY }, device);
  ctx.save();
  ctx.translate(view.offsetX + start.x * view.scale, view.offsetY + start.y * view.scale);
  ctx.scale(Math.sign(end.x - start.x) * view.scale, Math.sign(end.y - start.y) * view.scale);
  ctx.drawImage(source, 0, 0, Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  ctx.restore();
}

// ADR-492: the bitmap's rows run along the scan. Scan frame, machine, scene
// and screen are all affine, so three mapped points give the one transform
// that places every bitmap millimetre.
function drawAngledRasterBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  bounds: RasterMachineBounds,
  frame: RasterScanFrame,
  device: DeviceProfile,
  view: ViewTransform,
): void {
  const screen = (x: number, y: number): { readonly x: number; readonly y: number } => {
    const scene = toSceneCoords(scanToMachine(frame, { x, y }), device);
    return { x: view.offsetX + scene.x * view.scale, y: view.offsetY + scene.y * view.scale };
  };
  const origin = screen(bounds.minX, bounds.minY);
  const alongRow = screen(bounds.minX + 1, bounds.minY);
  const acrossRows = screen(bounds.minX, bounds.minY + 1);
  ctx.save();
  ctx.transform(
    alongRow.x - origin.x,
    alongRow.y - origin.y,
    acrossRows.x - origin.x,
    acrossRows.y - origin.y,
    origin.x,
    origin.y,
  );
  ctx.drawImage(bitmap, 0, 0, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  ctx.restore();
}
