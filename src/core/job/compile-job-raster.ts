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
import { ditherIndependentRow } from '../raster/dither';
import {
  STREAMED_RASTER_PIXEL_THRESHOLD,
  supportsStreamedRasterRows,
} from '../raster/raster-budget';
import { sceneObjectUsesOperation, type Layer, type RasterImage, type SceneObject } from '../scene';
import type { RasterGroup } from './job';
import { DEFAULT_OVERSCAN_MM } from './compile-job-defaults';
import { effectiveObjectMinPowerPercent, effectiveObjectPowerPercent } from './object-power-scale';
import { rasterBoundsInMachineCoords } from './raster-bounds';
import { decodeRasterLuma } from './raster-luma-decode';

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
  const streamRows =
    pixelWidth * pixelHeight > STREAMED_RASTER_PIXEL_THRESHOLD &&
    maskObject === null &&
    supportsStreamedRasterRows(layer.ditherAlgorithm);
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
          device,
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
    bidirectional: layer.imageBidirectional,
  };
}

type MaterializedRasterInput = {
  readonly preparedLuma: Uint8Array;
  readonly obj: RasterImage;
  readonly layer: Layer;
  readonly device: DeviceProfile;
  readonly maskObject: SceneObject | null;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly sMax: number;
  readonly sMin: number;
};

function materializedRasterValues(input: MaterializedRasterInput): Uint16Array {
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

type StreamedRasterInput = {
  readonly sourceLuma: Uint8Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly obj: RasterImage;
  readonly device: DeviceProfile;
  readonly algorithm: Layer['ditherAlgorithm'];
  readonly sMax: number;
  readonly sMin: number;
};

function streamedRasterRowProvider(input: StreamedRasterInput): (y: number) => Uint16Array {
  const objFlipX = input.obj.transform.mirrorX !== input.obj.transform.scaleX < 0;
  const objFlipY = input.obj.transform.mirrorY !== input.obj.transform.scaleY < 0;
  const flipX = originFlipsRasterX(input.device) !== objFlipX;
  const flipY = originFlipsRasterY(input.device) !== objFlipY;
  return (y: number): Uint16Array => {
    const luma = resampledOrientedRow(input, y, flipX, flipY);
    return ditherIndependentRow(luma, y, {
      algorithm: input.algorithm,
      sMax: input.sMax,
      sMin: input.sMin,
    });
  };
}

function resampledOrientedRow(
  input: StreamedRasterInput,
  y: number,
  flipX: boolean,
  flipY: boolean,
): Uint8Array {
  const targetY = flipY ? input.pixelHeight - 1 - y : y;
  const sourceY = nearestSourceCoordinate(targetY, input.sourceHeight, input.pixelHeight);
  const row = new Uint8Array(input.pixelWidth);
  for (let x = 0; x < input.pixelWidth; x += 1) {
    const targetX = flipX ? input.pixelWidth - 1 - x : x;
    const sourceX = nearestSourceCoordinate(targetX, input.sourceWidth, input.pixelWidth);
    row[x] = input.sourceLuma[sourceY * input.sourceWidth + sourceX] ?? WHITE_LUMA_BYTE;
  }
  return row;
}

function nearestSourceCoordinate(
  target: number,
  sourceExtent: number,
  targetExtent: number,
): number {
  return Math.min(sourceExtent - 1, Math.floor(((target + 0.5) * sourceExtent) / targetExtent));
}

function layerWithObjectOverride(layer: Layer, obj: SceneObject): Layer {
  if (obj.operationOverride === undefined) return layer;
  return { ...layer, ...obj.operationOverride };
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

function originFlipsRasterX(device: DeviceProfile): boolean {
  return device.origin === 'front-right' || device.origin === 'rear-right';
}

function originFlipsRasterY(device: DeviceProfile): boolean {
  return (
    device.origin === 'front-left' || device.origin === 'front-right' || device.origin === 'center'
  );
}
