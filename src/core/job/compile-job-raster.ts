import { type DeviceProfile } from '../devices';
import { clamp } from '../math';
import { applyImageMaskToLuma, dither, pixelExtentForMm, resampleLuma } from '../raster';
import { imageDitherAlgorithm, prepareImageLuma } from '../raster/image-processing';
import { burnGridKernel } from '../raster/luma-resample';
import { STREAMED_RASTER_PIXEL_THRESHOLD } from '../raster/raster-budget';
import type { RasterPowerValues } from '../raster/raster-power-values';
import { rasterCompilationPowerScale, rescaleRasterValues } from '../raster/controller-power-scale';
import { isAlongXScan, rasterScanFrame, type RasterScanFrame } from '../raster/raster-scan-frame';
import { originFlipsRasterX, originFlipsRasterY } from '../raster-output';
import {
  captureLayerOperationSettings,
  sceneObjectUsesOperation,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../scene';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../scene/effective-operation';
import type { JobDiagnostic, RasterGroup } from './job';
import { streamedRasterRowProvider } from './compile-job-raster-stream';
import { effectiveObjectMinPowerPercent, effectiveObjectPowerPercent } from './object-power-scale';
import { imageOverscanMmFor } from './operation-cut-extras';
import { rasterScanBounds, type RasterMachineBounds } from './raster-bounds';
import { decodeRasterLuma } from './raster-luma-decode';
import {
  needsRotatedSampling,
  rotatedMaskedRasterLuma,
  sourceQuarterTurn,
} from './raster-rotated-sample';
import { resolveImageScanDirection } from './scan-direction-policy';
import { imageScanPassRuns, type ScanPassRun } from './scan-pass-angles';
import { validatedScanOffsetMm } from './scan-offset';

const WHITE_LUMA_BYTE = 255;

type CompileRasterGroupsOptions = {
  readonly sceneObjects?: ReadonlyArray<SceneObject>;
  readonly sourceLumaByObjectId?: ReadonlyMap<string, Uint8Array>;
};

type CompileRasterGroupOptions = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly sourceLumaOverride: Uint8Array | undefined;
  readonly scanFrame: RasterScanFrame;
};

type RasterCompilation = {
  readonly groups: ReadonlyArray<RasterGroup>;
  readonly diagnostics: ReadonlyArray<JobDiagnostic>;
};

/**
 * Compile raster groups for one materialized operation and object set.
 * Optional luma overrides let worker-owned transient rasters avoid JSON/base64
 * serialization without changing persisted RasterImage data.
 */
export function compileRasterGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  options: CompileRasterGroupsOptions = {},
): RasterCompilation {
  const sceneObjects = options.sceneObjects ?? objects;
  const out: { groups: RasterGroup[]; diagnostics: JobDiagnostic[] } = {
    groups: [],
    diagnostics: [],
  };
  for (const obj of objects) {
    if (obj.kind !== 'raster-image' || !sceneObjectUsesOperation(obj, layer)) continue;
    if (obj.role === 'trace-source') continue;
    const effectiveLayer = effectiveOperationForObject(layer, obj);
    if (effectiveLayer.mode !== 'image') continue;
    appendObjectRasterGroups(obj, effectiveLayer, device, out, {
      objects: sceneObjects,
      sourceLumaOverride: options.sourceLumaByObjectId?.get(obj.id),
    });
  }
  return out;
}

// ADR-492: one group per run of passes at one scan angle, in pass order. Runs
// at the same angle share one compiled grid.
function appendObjectRasterGroups(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  out: { readonly groups: RasterGroup[]; readonly diagnostics: JobDiagnostic[] },
  options: Omit<CompileRasterGroupOptions, 'scanFrame'>,
): void {
  const scans = rasterScanRuns(layer, device);
  if (scans.rotaryIgnoresAngles) {
    out.diagnostics.push({
      kind: 'image-scan-angle-rotary',
      layerName: layer.name,
      source: obj.source,
    });
  }
  const byAngle = new Map<number, RasterGroup>();
  for (const run of scans.runs) {
    const group =
      byAngle.get(run.angleDeg) ??
      compileRasterGroup(obj, layer, device, {
        ...options,
        scanFrame: rasterScanFrame(run.angleDeg),
      });
    if (group === null) {
      out.diagnostics.push({
        kind: 'raster-source-luma-mismatch',
        layerName: layer.name,
        source: obj.source,
        expectedPixels: obj.pixelWidth * obj.pixelHeight,
        actualPixels: options.sourceLumaOverride?.length ?? 0,
      });
      return;
    }
    byAngle.set(run.angleDeg, group);
    out.groups.push(group.passes === run.passes ? group : { ...group, passes: run.passes });
  }
}

// A rotary maps Y through a scale that only keeps rows along X straight, so it
// scans every pass along X and Job Review says the angles were set aside.
function rasterScanRuns(
  layer: Layer,
  device: DeviceProfile,
): { readonly runs: ReadonlyArray<ScanPassRun>; readonly rotaryIgnoresAngles: boolean } {
  const runs = imageScanPassRuns(layer);
  if (device.rotary?.enabled !== true) return { runs, rotaryIgnoresAngles: false };
  const alongX = runs.length === 1 && runs[0]?.angleDeg === 0;
  return {
    runs: [{ angleDeg: 0, passes: Math.max(1, Math.floor(layer.passes)) }],
    rotaryIgnoresAngles: !alongX,
  };
}

function compileRasterGroup(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  options: CompileRasterGroupOptions,
): RasterGroup | null {
  const bidirectionalScanOffsetMm = validatedScanOffsetMm(device, layer.bidirectionalScanOffsetMm);
  const scanDirection = resolveImageScanDirection(device, layer);
  const sourceLuma = sourceLumaForRaster(obj, options.sourceLumaOverride);
  if (sourceLuma === null) return null;
  const preparedLuma = prepareImageLuma(sourceLuma, obj, layer);
  const powerPercent = effectiveObjectPowerPercent(layer, obj);
  const minPowerPercent = effectiveObjectMinPowerPercent(layer, obj);
  const compilationMaxS = rasterCompilationPowerScale(device);
  const sMax = Math.round((powerPercent / 100) * compilationMaxS);
  const sMin = Math.round((minPowerPercent / 100) * compilationMaxS);
  const bounds = rasterScanBounds(obj, device, options.scanFrame);
  const passThroughDimensions = rasterPassThroughDimensions(obj, device, options.scanFrame);
  const pixelWidth = layer.passThrough
    ? passThroughDimensions.width
    : pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
  const pixelHeight = layer.passThrough
    ? passThroughDimensions.height
    : pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
  const lineIntervalMm = (bounds.maxY - bounds.minY) / pixelHeight;
  const maskObject = imageMaskObjectFor(obj, options.objects);
  const rasterInput = {
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
    scanFrame: options.scanFrame,
  };
  const rasterValues = rasterValuesFor(rasterInput);
  return {
    kind: 'raster',
    layerId: layer.id,
    sourceObjectId: obj.id,
    source: obj.source,
    color: layer.color,
    power: powerPercent,
    speed: Math.min(layer.speed, device.maxFeed),
    ...(layer.speed <= device.maxFeed ? {} : { requestedSpeed: layer.speed }),
    ...(operationOverrideForObject(layer, obj) === undefined
      ? {}
      : { operationSettings: captureLayerOperationSettings(layer) }),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
    ...rasterValues,
    pixelWidth,
    pixelHeight,
    bounds,
    overscanMm: imageOverscanMmFor(layer),
    dotWidthCorrectionMm: clamp(layer.dotWidthCorrectionMm, 0, lineIntervalMm),
    bidirectional: scanDirection.bidirectional,
    scanDirection,
    ...(bidirectionalScanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm }),
    ...(isAlongXScan(options.scanFrame) ? {} : { scanAngleDeg: options.scanFrame.angleDeg }),
  };
}

function rasterPassThroughDimensions(
  obj: RasterImage,
  device: DeviceProfile,
  scanFrame: RasterScanFrame,
): {
  readonly width: number;
  readonly height: number;
} {
  const turn = sourceQuarterTurn(obj, device, scanFrame);
  const swapsAxes = turn === 1 || turn === 3;
  return swapsAxes
    ? { width: obj.pixelHeight, height: obj.pixelWidth }
    : { width: obj.pixelWidth, height: obj.pixelHeight };
}

function rasterValuesFor(
  input: MaterializedRasterInput,
): Pick<RasterGroup, 'sValues' | 'rowProvider'> {
  const compilationMaxS = rasterCompilationPowerScale(input.device);
  const toDeviceUnits = (values: RasterPowerValues): RasterPowerValues =>
    compilationMaxS === input.device.maxPowerS
      ? values
      : rescaleRasterValues(values, compilationMaxS, input.device.maxPowerS);
  // Streaming works for every dither algorithm and mask (ADR-243); only size
  // chooses between one-shot materialization and an O(width) row provider.
  if (input.pixelWidth * input.pixelHeight <= STREAMED_RASTER_PIXEL_THRESHOLD) {
    return { sValues: toDeviceUnits(materializedRasterValues(input)) };
  }
  const rowProvider = streamedRasterRowProvider({
    sourceLuma: input.preparedLuma,
    sourceWidth: input.obj.pixelWidth,
    sourceHeight: input.obj.pixelHeight,
    pixelWidth: input.pixelWidth,
    pixelHeight: input.pixelHeight,
    obj: input.obj,
    maskObject: input.maskObject,
    device: input.device,
    bounds: input.bounds,
    scanFrame: input.scanFrame,
    algorithm: imageDitherAlgorithm(input.layer),
    passThrough: input.layer.passThrough,
    sMax: input.sMax,
    sMin: input.sMin,
  });
  return {
    sValues: new Float64Array(0),
    rowProvider: (y) => toDeviceUnits(rowProvider(y)),
  };
}

function sourceLumaForRaster(
  obj: RasterImage,
  sourceLumaOverride: Uint8Array | undefined,
): Uint8Array | null {
  const sourceLuma = sourceLumaOverride ?? decodeRasterLuma(obj);
  return sourceLuma.length === obj.pixelWidth * obj.pixelHeight ? sourceLuma : null;
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
  readonly scanFrame: RasterScanFrame;
};

function materializedRasterValues(input: MaterializedRasterInput): RasterPowerValues {
  // Rotated images and angled scans bypass the axis-aligned resample + flip
  // pipeline: the scan grid samples the rotated content directly.
  if (needsRotatedSampling(input.obj, input.scanFrame)) {
    const rotatedLuma = rotatedMaskedRasterLuma(
      {
        sourceLuma: input.preparedLuma,
        obj: input.obj,
        device: input.device,
        bounds: input.bounds,
        pixelWidth: input.pixelWidth,
        pixelHeight: input.pixelHeight,
        scanFrame: input.scanFrame,
        kernel: burnGridKernel(imageDitherAlgorithm(input.layer)),
        passThrough: input.layer.passThrough,
      },
      input.maskObject,
    );
    return dither(
      { luma: rotatedLuma, width: input.pixelWidth, height: input.pixelHeight },
      { algorithm: imageDitherAlgorithm(input.layer), sMax: input.sMax, sMin: input.sMin },
    );
  }
  const luma = input.layer.passThrough
    ? input.preparedLuma
    : resampleLuma(
        {
          luma: input.preparedLuma,
          width: input.obj.pixelWidth,
          height: input.obj.pixelHeight,
        },
        input.pixelWidth,
        input.pixelHeight,
        burnGridKernel(imageDitherAlgorithm(input.layer)),
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
    { algorithm: imageDitherAlgorithm(input.layer), sMax: input.sMax, sMin: input.sMin },
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
