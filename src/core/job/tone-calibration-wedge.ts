// ADR-670: a labelled grey step wedge for photo tone calibration. Every patch
// burns on one Image operation that copies the photo's own settings (dither,
// interval, power, speed, Negative and the rest) without its tone curve, so the
// burn measures the material's raw response to those exact settings.

import { encodeBmp24 } from '../raster/encode-bmp';
import { encodeCanonicalBase64 } from '../relief/depth-map-base64';
import {
  captureLayerOperationSettings,
  createLayer,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type LayerOperationSettings,
  type RasterImage,
  type Scene,
} from '../scene';
import {
  calibrationLabelWidthMm,
  createCalibrationLabelLayer,
  createCalibrationLabelObject,
} from './calibration-labels';

export const TONE_WEDGE_MIN_PATCHES = 6;
export const TONE_WEDGE_MAX_PATCHES = 21;
export const TONE_WEDGE_DEFAULT_PATCHES = 11;
export const TONE_WEDGE_MIN_PATCH_MM = 3;
export const TONE_WEDGE_MAX_PATCH_MM = 50;
export const TONE_WEDGE_MAX_GAP_MM = 10;
export const TONE_WEDGE_OPERATION_ID = 'tone-calibration-wedge';
export const TONE_WEDGE_OBJECT_ID = 'tone-calibration-wedge-image';
export const TONE_WEDGE_SOURCE = 'tone-calibration-wedge';

const BYTE_MAX = 255;
// The wedge's own source pixels. Patches are uniform, so only their edges need
// pixels; patch and gap sizes snap to this grid so every patch is exact.
const SOURCE_PX_PER_MM = 4;
const DEFAULT_GAP_MM = 1;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;
// Not the default image colour, so a photo imported next to the wedge gets its
// own Image operation instead of joining the uncalibrated wedge's.
const WEDGE_OPERATION_COLOR = '#6f6f6f';

export type ToneWedgeOptions = {
  readonly patchCount: number;
  readonly patchSizeMm: number;
  readonly gapMm?: number;
  /** The photo's effective operation; its tone curve is dropped for the burn. */
  readonly operation: LayerOperationSettings;
  readonly origin?: { readonly x: number; readonly y: number };
};

export type ToneWedgePatch = {
  readonly index: number;
  /** Mark strength this patch asks for, 0 (blank) .. 100 (solid), after luma rounding. */
  readonly commandedPercent: number;
  /** The burn-side luma the ditherer sees for this patch. */
  readonly burnLuma: number;
  readonly label: string;
  readonly bounds: Bounds;
};

export type ToneWedge = {
  readonly scene: Scene;
  readonly operationId: string;
  readonly patches: ReadonlyArray<ToneWedgePatch>;
};

/** Burn-side luma of each patch: evenly spaced from blank (255) to solid (0). */
export function toneWedgeBurnLumas(patchCount: number): ReadonlyArray<number> {
  const count = clampPatchCount(patchCount);
  return Array.from({ length: count }, (_, index) =>
    Math.round(BYTE_MAX * (1 - index / (count - 1))),
  );
}

/** The mark strength each patch truly asks for, 0..100 %, as the record step uses it. */
export function toneWedgeCommandedPercents(patchCount: number): ReadonlyArray<number> {
  return toneWedgeBurnLumas(patchCount).map((luma) => 100 * (1 - luma / BYTE_MAX));
}

export function generateToneCalibrationWedge(options: ToneWedgeOptions): ToneWedge {
  const burnLumas = toneWedgeBurnLumas(options.patchCount);
  const patchMm = snapMm(
    clamp(options.patchSizeMm, TONE_WEDGE_MIN_PATCH_MM, TONE_WEDGE_MAX_PATCH_MM),
  );
  const gapMm = snapMm(clamp(options.gapMm ?? DEFAULT_GAP_MM, 0, TONE_WEDGE_MAX_GAP_MM));
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const layer = wedgeOperation(options.operation);
  const image = wedgeImage({ burnLumas, patchMm, gapMm, layer, origin });
  const patches = burnLumas.map((burnLuma, index): ToneWedgePatch => {
    const minX = origin.x + index * (patchMm + gapMm);
    const commandedPercent = 100 * (1 - burnLuma / BYTE_MAX);
    return {
      index,
      commandedPercent,
      burnLuma,
      label: String(Math.round(commandedPercent)),
      bounds: { minX, minY: origin.y, maxX: minX + patchMm, maxY: origin.y + patchMm },
    };
  });
  const labelLayer = createCalibrationLabelLayer('tone-calibration-labels');
  const labels = patchLabels(patches, labelLayer.id, patchMm, gapMm);
  return {
    scene: { objects: [image, ...labels], layers: [layer, labelLayer] },
    operationId: layer.id,
    patches,
  };
}

function wedgeOperation(settings: LayerOperationSettings): Layer {
  const { photoToneCurve: _curve, ...measured } = captureLayerOperationSettings(settings);
  const base = createLayer({
    id: TONE_WEDGE_OPERATION_ID,
    color: WEDGE_OPERATION_COLOR,
    mode: 'image',
  });
  return {
    ...base,
    ...measured,
    name: 'Tone calibration wedge',
    mode: 'image',
    passThrough: false,
  };
}

function wedgeImage(args: {
  readonly burnLumas: ReadonlyArray<number>;
  readonly patchMm: number;
  readonly gapMm: number;
  readonly layer: Layer;
  readonly origin: { readonly x: number; readonly y: number };
}): RasterImage {
  const patchPx = Math.round(args.patchMm * SOURCE_PX_PER_MM);
  const pitchPx = Math.round((args.patchMm + args.gapMm) * SOURCE_PX_PER_MM);
  const width = pitchPx * (args.burnLumas.length - 1) + patchPx;
  const height = patchPx;
  // Negative inverts the photo before dithering, so the source holds the
  // inverse there: the ditherer sees the same burn luma for either material.
  const sourceLuma = (burn: number): number => (args.layer.negativeImage ? BYTE_MAX - burn : burn);
  const luma = new Uint8Array(width * height).fill(sourceLuma(BYTE_MAX));
  for (const [index, burn] of args.burnLumas.entries()) {
    const start = index * pitchPx;
    for (let y = 0; y < height; y += 1) {
      luma.fill(sourceLuma(burn), y * width + start, y * width + start + patchPx);
    }
  }
  const widthMm = width / SOURCE_PX_PER_MM;
  const heightMm = height / SOURCE_PX_PER_MM;
  return {
    kind: 'raster-image',
    id: TONE_WEDGE_OBJECT_ID,
    source: TONE_WEDGE_SOURCE,
    dataUrl: `data:image/bmp;base64,${encodeCanonicalBase64(bmpForLuma(luma, width, height))}`,
    lumaBase64: encodeCanonicalBase64(luma),
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    transform: { ...IDENTITY_TRANSFORM, x: args.origin.x, y: args.origin.y },
    color: args.layer.color,
    operationIds: [args.layer.id],
    dither: args.layer.ditherAlgorithm,
    linesPerMm: args.layer.linesPerMm,
  };
}

function bmpForLuma(luma: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < luma.length; index += 1) {
    const value = luma[index] ?? BYTE_MAX;
    rgba.set([value, value, value, BYTE_MAX], index * 4);
  }
  return encodeBmp24(rgba, width, height);
}

function patchLabels(
  patches: ReadonlyArray<ToneWedgePatch>,
  labelLayerId: string,
  patchMm: number,
  gapMm: number,
): ReadonlyArray<ImportedSvg> {
  const baseSize = Math.max(1.4, Math.min(3, patchMm * 0.3));
  const labelGap = Math.max(1, Math.min(gapMm, 2));
  return patches.map((patch) => {
    const width = calibrationLabelWidthMm(patch.label, baseSize);
    const sizeMm = baseSize * Math.min(1, (patchMm * 0.9) / Math.max(width, 1e-6));
    const labelWidth = calibrationLabelWidthMm(patch.label, sizeMm);
    return createCalibrationLabelObject({
      id: `tone-calibration-label-${patch.index}`,
      operationId: labelLayerId,
      text: patch.label,
      x: patch.bounds.minX + Math.max(0, (patchMm - labelWidth) / 2),
      y: patch.bounds.maxY + labelGap,
      sizeMm,
    });
  });
}

function clampPatchCount(value: number): number {
  const whole = Number.isFinite(value) ? Math.floor(value) : TONE_WEDGE_DEFAULT_PATCHES;
  return Math.max(TONE_WEDGE_MIN_PATCHES, Math.min(TONE_WEDGE_MAX_PATCHES, whole));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function snapMm(value: number): number {
  return Math.round(value * SOURCE_PX_PER_MM) / SOURCE_PX_PER_MM;
}
