// Rotated raster sampling — maps machine scan-grid pixel centers back into
// the source bitmap. Scan rows must stay horizontal in machine space, so a
// rotated image cannot reuse the axis-aligned resample + flip pipeline;
// instead each machine pixel center is mapped through the device-origin
// inverse and the inverse object transform into source pixels. Points outside
// the image footprint read white, so the bounding-box padding around the
// rotated content stays unburned. Zero-rotation images keep the legacy
// pipeline (byte-identical output; see compile-job-raster.ts).

import { toSceneCoords, type DeviceProfile } from '../devices';
import { applyImageMaskToLuma } from '../raster';
import type { RasterImage, SceneObject, Transform, Vec2 } from '../scene';
import type { RasterMachineBounds } from './raster-bounds';

const WHITE_LUMA_BYTE = 255;
const FULL_TURN_DEG = 360;
const DEG_TO_RAD = Math.PI / 180;

export function isRotatedRaster(obj: RasterImage): boolean {
  return ((obj.transform.rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG !== 0;
}

export type RotatedRasterSampler = {
  readonly sourceLuma: Uint8Array;
  readonly obj: RasterImage;
  readonly device: DeviceProfile;
  readonly bounds: RasterMachineBounds;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

// One machine-grid row of source luma. The machine→source mapping is affine,
// so the row walks a constant per-pixel step instead of transforming every
// pixel center individually.
export function rotatedRasterRow(input: RotatedRasterSampler, y: number): Uint8Array {
  const { sourceLuma, obj, pixelWidth } = input;
  const sourceWidth = obj.pixelWidth;
  const sourceHeight = obj.pixelHeight;
  const row = new Uint8Array(pixelWidth);
  const start = sourcePixelPoint(input, 0, y);
  const next = sourcePixelPoint(input, 1, y);
  const stepX = next.x - start.x;
  const stepY = next.y - start.y;
  for (let x = 0; x < pixelWidth; x += 1) {
    const sx = Math.floor(start.x + x * stepX);
    const sy = Math.floor(start.y + x * stepY);
    // Positive-form check so NaN (e.g. zero scale) also falls to white.
    const isInside = sx >= 0 && sx < sourceWidth && sy >= 0 && sy < sourceHeight;
    row[x] = isInside ? (sourceLuma[sy * sourceWidth + sx] ?? WHITE_LUMA_BYTE) : WHITE_LUMA_BYTE;
  }
  return row;
}

export function rotatedMaskedRasterLuma(
  input: RotatedRasterSampler,
  maskObject: SceneObject | null,
): Uint8Array {
  const maskedSource = applyImageMaskToLuma({
    image: input.obj,
    maskObject,
    luma: input.sourceLuma,
    width: input.obj.pixelWidth,
    height: input.obj.pixelHeight,
  });
  const masked: RotatedRasterSampler = { ...input, sourceLuma: maskedSource };
  const out = new Uint8Array(input.pixelWidth * input.pixelHeight);
  for (let y = 0; y < input.pixelHeight; y += 1) {
    out.set(rotatedRasterRow(masked, y), y * input.pixelWidth);
  }
  return out;
}

function sourcePixelPoint(input: RotatedRasterSampler, x: number, y: number): Vec2 {
  const { bounds, pixelWidth, pixelHeight, obj, device } = input;
  const machine = {
    x: bounds.minX + ((x + 0.5) / pixelWidth) * (bounds.maxX - bounds.minX),
    y: bounds.minY + ((y + 0.5) / pixelHeight) * (bounds.maxY - bounds.minY),
  };
  const local = invertObjectTransform(toSceneCoords(machine, device), obj.transform);
  return {
    x: ((local.x - obj.bounds.minX) / (obj.bounds.maxX - obj.bounds.minX)) * obj.pixelWidth,
    y: ((local.y - obj.bounds.minY) / (obj.bounds.maxY - obj.bounds.minY)) * obj.pixelHeight,
  };
}

// Exact inverse of core/scene/transform.ts applyTransform
// (scale → mirror → rotate → translate), so the burn stays in register with
// the canvas render, which composes the forward transform.
function invertObjectTransform(p: Vec2, t: Transform): Vec2 {
  const rad = -t.rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  let x = dx * cos - dy * sin;
  let y = dx * sin + dy * cos;
  if (t.mirrorX) x = -x;
  if (t.mirrorY) y = -y;
  return { x: x / t.scaleX, y: y / t.scaleY };
}
