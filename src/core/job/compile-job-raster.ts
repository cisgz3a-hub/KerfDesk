import { type DeviceProfile } from '../devices';
import { clamp } from '../math';
import {
  applyImageMaskToLuma,
  applyLumaAdjustments,
  dither,
  maybeInvertLuma,
  pixelExtentForMm,
  resampleLumaNearest,
} from '../raster';
import { STREAMED_RASTER_PIXEL_THRESHOLD } from '../raster/raster-budget';
import { sceneObjectUsesOperation, type Layer, type RasterImage, type SceneObject } from '../scene';
import type { RasterGroup } from './job';
import { DEFAULT_OVERSCAN_MM } from './compile-job-defaults';
import {
  originFlipsRasterX,
  originFlipsRasterY,
  streamedRasterRowProvider,
} from './compile-job-raster-stream';
import { layerWithObjectOverride } from './compile-job-object-policy';
import { effectiveObjectMinPowerPercent, effectiveObjectPowerPercent } from './object-power-scale';
import { rasterBoundsInMachineCoords, type RasterMachineBounds } from './raster-bounds';
import { decodeRasterLuma } from './raster-luma-decode';
import { isRotatedRaster, rotatedMaskedRasterLuma } from './raster-rotated-sample';
import { resolveImageScanDirection } from './scan-direction-policy';
import { validatedScanOffsetMm } from './scan-offset';

const WHITE_LUMA_BYTE = 255;

export function compileRasterGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  sceneObjects: ReadonlyArray<SceneObject> = objects,
): RasterGroup[] {
  const groups: RasterGroup[] = [];
  for (const obj of objects) {
    if (obj.kind !== 'raster-image' || !sceneObjectUsesOperation(obj, layer)) continue;
    if (obj.role === 'trace-source') continue;
    const effectiveLayer = layerWithObjectOverride(layer, obj);
    if (effectiveLayer.mode !== 'image') continue;
    groups.push(compileRasterGroup(obj, effectiveLayer, device, sceneObjects));
  }
  return groups;
}

function compileRasterGroup(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  objects: ReadonlyArray<SceneObject>,
): RasterGroup {
  const bidirectionalScanOffsetMm = validatedScanOffsetMm(device, layer.bidirectionalScanOffsetMm);
  const scanDirection = resolveImageScanDirection(device, layer);
  const sourceLuma = decodeRasterLuma(obj);
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
  const maskObject = imageMaskObjectFor(obj, objects);
  // Streaming works for every dither algorithm and for masked images
  // (ADR-243), so the only decision left is size: small rasters keep the
  // one-shot materialized dither, large ones hold O(width) state instead.
  const streamRows = pixelWidth * pixelHeight > STREAMED_RASTER_PIXEL_THRESHOLD;
  const rasterValues = streamRows
    ? {
        sValues: new Uint16Array(0),
        rowProvider: streamedRasterRowProvider({
          sourceLuma: preparedLuma,
          sourceWidth: obj.pixelWidth,
          sourceHeight: obj.pixelHeight,
          pixelWidth,
          pixelHeight,
          obj,
          maskObject,
          device,
          bounds,
          algorithm: layer.ditherAlgorithm,
          sMax,
          sMin,
        }),
      }
    : {
        sValues: materializedRasterValues({
          preparedLuma,
          obj,
          layer,
          device,
          bounds,
          maskObject,
          pixelWidth,
          pixelHeight,
          sMax,
          sMin,
        }),
      };
  return {
    kind: 'raster',
    layerId: layer.id,
    sourceObjectId: obj.id,
    source: obj.source,
    color: layer.color,
    power: powerPercent,
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
    ...rasterValues,
    pixelWidth,
    pixelHeight,
    bounds,
    overscanMm: DEFAULT_OVERSCAN_MM,
    dotWidthCorrectionMm: clamp(layer.dotWidthCorrectionMm, 0, lineIntervalMm),
    bidirectional: scanDirection.bidirectional,
    scanDirection,
    ...(bidirectionalScanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm }),
  };
}

type MaterializedRasterInput = {
  readonly preparedLuma: Uint8Array;
  readonly obj: RasterImage;
  readonly layer: Layer;
  readonly device: DeviceProfile;
  readonly bounds: RasterMachineBounds;
  readonly maskObject: SceneObject | null;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly sMax: number;
  readonly sMin: number;
};

function materializedRasterValues(input: MaterializedRasterInput): Uint16Array {
  // Rotated images bypass the axis-aligned resample + flip pipeline: the
  // machine scan grid samples the rotated content directly.
  if (isRotatedRaster(input.obj)) {
    const rotatedLuma = rotatedMaskedRasterLuma(
      {
        sourceLuma: input.preparedLuma,
        obj: input.obj,
        device: input.device,
        bounds: input.bounds,
        pixelWidth: input.pixelWidth,
        pixelHeight: input.pixelHeight,
      },
      input.maskObject,
    );
    return dither(
      { luma: rotatedLuma, width: input.pixelWidth, height: input.pixelHeight },
      { algorithm: input.layer.ditherAlgorithm, sMax: input.sMax, sMin: input.sMin },
    );
  }
  const luma = input.layer.passThrough
    ? input.preparedLuma
    : resampleLumaNearest(
        {
          luma: input.preparedLuma,
          width: input.obj.pixelWidth,
          height: input.obj.pixelHeight,
        },
        input.pixelWidth,
        input.pixelHeight,
      );
  const maskedLuma = applyImageMaskToLuma({
    image: input.obj,
    maskObject: input.maskObject,
    luma,
    width: input.pixelWidth,
    height: input.pixelHeight,
  });
  const orientedLuma = orientRasterLumaForMachine(
    maskedLuma,
    input.pixelWidth,
    input.pixelHeight,
    input.obj,
    input.device,
  );
  return dither(
    { luma: orientedLuma, width: input.pixelWidth, height: input.pixelHeight },
    { algorithm: input.layer.ditherAlgorithm, sMax: input.sMax, sMin: input.sMin },
  );
}

function imageMaskObjectFor(
  obj: RasterImage,
  objects: ReadonlyArray<SceneObject>,
): SceneObject | null {
  if (obj.imageMaskId === undefined) return null;
  return objects.find((candidate) => candidate.id === obj.imageMaskId) ?? null;
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
