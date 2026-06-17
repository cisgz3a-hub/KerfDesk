import { type DeviceProfile } from '../devices';
import {
  applyLumaAdjustments,
  dither,
  maybeInvertLuma,
  pixelExtentForMm,
  resampleLumaNearest,
  whiteLuma,
} from '../raster';
import { type Layer, type RasterImage } from '../scene';
import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
} from './object-power-scale';
import { rasterBoundsInMachineCoords } from './raster-bounds';
import type { RasterGroup } from './job';

export const DEFAULT_OVERSCAN_MM = 5;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const WHITE_LUMA_BYTE = 255;

export function compileRasterGroup(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
): RasterGroup {
  const sourceLuma =
    obj.lumaBase64 !== undefined
      ? decodeBase64Luma(obj.lumaBase64, obj.pixelWidth * obj.pixelHeight)
      : whiteLuma(obj.pixelWidth * obj.pixelHeight);
  const adjustedLuma = applyLumaAdjustments(sourceLuma, obj);
  const preparedLuma = maybeInvertLuma(adjustedLuma, layer.negativeImage);
  const powerPercent = effectiveObjectPowerPercent(layer, obj);
  const minPowerPercent = effectiveObjectMinPowerPercent(layer, obj);
  const sMax = Math.round((powerPercent / 100) * device.maxPowerS);
  const sMin = Math.round((minPowerPercent / 100) * device.maxPowerS);
  const bounds = rasterBoundsInMachineCoords(obj, device);
  const pixelWidth = layer.passThrough
    ? obj.pixelWidth
    : pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
  const pixelHeight = layer.passThrough
    ? obj.pixelHeight
    : pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
  const lineIntervalMm = (bounds.maxY - bounds.minY) / pixelHeight;
  const luma = layer.passThrough
    ? preparedLuma
    : resampleLumaNearest(
        { luma: preparedLuma, width: obj.pixelWidth, height: obj.pixelHeight },
        pixelWidth,
        pixelHeight,
      );
  const orientedLuma = orientRasterLumaForMachine(luma, pixelWidth, pixelHeight, obj, device);
  const sValues = dither(
    { luma: orientedLuma, width: pixelWidth, height: pixelHeight },
    { algorithm: layer.ditherAlgorithm, sMax, sMin },
  );
  return {
    kind: 'raster',
    layerId: layer.id,
    color: layer.color,
    power: powerPercent,
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
    sValues,
    pixelWidth,
    pixelHeight,
    bounds,
    overscanMm: DEFAULT_OVERSCAN_MM,
    dotWidthCorrectionMm: clamp(layer.dotWidthCorrectionMm, 0, lineIntervalMm),
  };
}

function orientRasterLumaForMachine(
  luma: Uint8Array,
  width: number,
  height: number,
  obj: RasterImage,
  device: DeviceProfile,
): Uint8Array {
  const objFlipX = obj.transform.mirrorX !== obj.transform.scaleX < 0;
  const objFlipY = obj.transform.mirrorY !== obj.transform.scaleY < 0;
  const flipX = originFlipsRasterX(device) !== objFlipX;
  const flipY = originFlipsRasterY(device) !== objFlipY;
  if (!flipX && !flipY) return luma;
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < height; y += 1) {
    const srcY = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const srcX = flipX ? width - 1 - x : x;
      out[y * width + x] = luma[srcY * width + srcX] ?? WHITE_LUMA_BYTE;
    }
  }
  return out;
}

function originFlipsRasterX(device: DeviceProfile): boolean {
  return device.origin === 'front-right' || device.origin === 'rear-right';
}

function originFlipsRasterY(device: DeviceProfile): boolean {
  return (
    device.origin === 'front-left' || device.origin === 'front-right' || device.origin === 'center'
  );
}

function decodeBase64Luma(base64: string, expectedLength: number): Uint8Array {
  const out = whiteLuma(expectedLength);
  let outIndex = 0;
  let buffer = 0;
  let bitCount = 0;
  for (const char of base64) {
    if (outIndex >= expectedLength || char === '=') break;
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue;
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) return whiteLuma(expectedLength);
    buffer = (buffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[outIndex] = (buffer >> bitCount) & 0xff;
      outIndex += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
