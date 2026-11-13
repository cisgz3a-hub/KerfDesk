// ADR-711: a Photo Test Card. Every square burns the same piece of the
// operator's own photo with the photo's own processing (tones, sharpening,
// dither, interval, marking and any tone calibration). Only power, across, and
// speed, down, change, so the square that looks best names the power and
// speed to burn the whole photo with.

import { encodeBmp8Grey } from '../raster/encode-bmp';
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
import { createCalibrationLabelLayer } from './calibration-labels';
import { materialTestAxis, type MaterialTestAxis } from './material-test-axes';
import {
  cellX,
  cellY,
  materialTestLabelObjects,
  materialTestLayout,
  type MaterialTestLayout,
} from './material-test-layout';
import { imageOverscanMmFor } from './operation-cut-extras';
import type { PhotoTestPatch } from './photo-test-patch';

export const PHOTO_TEST_MIN_COUNT = 1;
export const PHOTO_TEST_MAX_COUNT = 8;
export const PHOTO_TEST_MAX_GAP_MM = 20;
export const PHOTO_TEST_CELL_SOURCE = 'photo-test-card-cell';

const DEFAULT_GAP_MM = 2;
const DEFAULT_ORIGIN = { x: 0, y: 0 } as const;
// Neither the default image colour nor the tone wedge's, so a photo imported
// next to the card gets its own Image operation.
const FIRST_ROW_COLOR = 0x707070;

/** The photo's tone and sharpening fields, which live on the image itself. */
export type PhotoTestTones = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly sharpenAmount?: number;
  readonly sharpenRadius?: number;
};

export type PhotoTestCardOptions = {
  /** Speeds, one per row, fastest first. */
  readonly rows: number;
  /** Powers, one per column, lowest first. */
  readonly columns: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly powerMin: number;
  readonly powerMax: number;
  /** Active profile compile ceiling; a faster row burns, and is labelled, at it. */
  readonly maxFeedMmPerMin?: number;
  readonly gapMm?: number;
  readonly origin?: { readonly x: number; readonly y: number };
  readonly patch: PhotoTestPatch;
  /** The photo's effective operation; each square replaces only power and speed. */
  readonly operation: LayerOperationSettings;
  readonly tones: PhotoTestTones;
};

export type PhotoTestCell = {
  readonly row: number;
  readonly column: number;
  readonly objectId: string;
  readonly layerId: string;
  readonly power: number;
  /** Feed the compiler emits for this square. */
  readonly speed: number;
  readonly requestedSpeed: number;
  readonly bounds: Bounds;
};

export type PhotoTestCard = {
  readonly scene: Scene;
  readonly cells: ReadonlyArray<PhotoTestCell>;
  /** Column powers in percent, lowest first. */
  readonly powers: ReadonlyArray<number>;
  /** Row speeds as the job runs them, fastest first. */
  readonly speeds: ReadonlyArray<number>;
};

/** The powers and speeds a card will hold, shared with the dialog. */
export function photoTestCardAxes(
  options: Pick<
    PhotoTestCardOptions,
    'rows' | 'columns' | 'speedMin' | 'speedMax' | 'powerMin' | 'powerMax' | 'maxFeedMmPerMin'
  >,
): { readonly speedAxis: MaterialTestAxis; readonly powerAxis: MaterialTestAxis } {
  return {
    speedAxis: materialTestAxis('speed', clampCount(options.rows), options),
    powerAxis: materialTestAxis('power', clampCount(options.columns), options),
  };
}

export function generatePhotoTestCard(options: PhotoTestCardOptions): PhotoTestCard {
  const { speedAxis, powerAxis } = photoTestCardAxes(options);
  const base = captureLayerOperationSettings(options.operation);
  const layers = speedAxis.values.map((speed, row) =>
    rowOperation(base, row, speed, speedAxis.labels[row] ?? '', powerAxis.values[0] ?? 0),
  );
  const layout = materialTestLayout({
    origin: options.origin ?? DEFAULT_ORIGIN,
    cellWidth: options.patch.widthMm,
    cellHeight: options.patch.heightMm,
    gap: clampGap(options.gapMm),
    rowLabels: speedAxis.labels,
    columnLabels: powerAxis.labels,
    // Each square's laser-off runway stays right of the card's origin.
    runwayMm: imageOverscanMmFor(base),
  });
  const pixels = patchPixels(options.patch);
  const objects: RasterImage[] = [];
  const cells: PhotoTestCell[] = [];
  layers.forEach((layer, row) => {
    powerAxis.values.forEach((power, column) => {
      const cell: PhotoTestCell = {
        row,
        column,
        objectId: `photo-test-cell-r${row}-c${column}`,
        layerId: layer.id,
        power,
        speed: speedAxis.effectiveValues[row] ?? layer.speed,
        requestedSpeed: layer.speed,
        bounds: cellBounds(layout, row, column),
      };
      cells.push(cell);
      objects.push(cellImage({ cell, layer, pixels, patch: options.patch, tones: options.tones }));
    });
  });
  const labelLayer = createCalibrationLabelLayer('photo-test-labels');
  return {
    scene: {
      objects: [...objects, ...labelObjects(layout, labelLayer.id)],
      layers: [...layers, labelLayer],
    },
    cells,
    powers: powerAxis.values,
    speeds: speedAxis.effectiveValues,
  };
}

// One Image operation per row carries the row's speed and the first column's
// power; the other squares override the power alone.
function rowOperation(
  base: LayerOperationSettings,
  row: number,
  speed: number,
  speedLabel: string,
  power: number,
): Layer {
  return {
    ...createLayer({
      id: `photo-test-row-${row}`,
      color: `#${(FIRST_ROW_COLOR + row).toString(16)}`,
      mode: 'image',
    }),
    ...base,
    name: `Photo test ${speedLabel} mm/min`,
    mode: 'image',
    passThrough: false,
    speed,
    power,
  };
}

type PatchPixels = { readonly dataUrl: string; readonly lumaBase64: string };

function patchPixels(patch: PhotoTestPatch): PatchPixels {
  const bmp = encodeBmp8Grey(patch.luma, patch.pixelWidth, patch.pixelHeight);
  return {
    dataUrl: `data:image/bmp;base64,${encodeCanonicalBase64(bmp)}`,
    lumaBase64: encodeCanonicalBase64(patch.luma),
  };
}

function cellImage(args: {
  readonly cell: PhotoTestCell;
  readonly layer: Layer;
  readonly pixels: PatchPixels;
  readonly patch: PhotoTestPatch;
  readonly tones: PhotoTestTones;
}): RasterImage {
  const { cell, layer, patch, tones } = args;
  const sharpenAmount = tones.sharpenAmount ?? 0;
  return {
    kind: 'raster-image',
    id: cell.objectId,
    source: PHOTO_TEST_CELL_SOURCE,
    ...args.pixels,
    pixelWidth: patch.pixelWidth,
    pixelHeight: patch.pixelHeight,
    bounds: { minX: 0, minY: 0, maxX: patch.widthMm, maxY: patch.heightMm },
    transform: { ...IDENTITY_TRANSFORM, x: cell.bounds.minX, y: cell.bounds.minY },
    color: layer.color,
    operationIds: [layer.id],
    dither: layer.ditherAlgorithm,
    linesPerMm: layer.linesPerMm,
    brightness: tones.brightness,
    contrast: tones.contrast,
    gamma: tones.gamma,
    // Sharpening off leaves no fields, as Photo engraving writes it (ADR-671).
    ...(sharpenAmount > 0
      ? {
          sharpenAmount,
          ...(tones.sharpenRadius === undefined ? {} : { sharpenRadius: tones.sharpenRadius }),
        }
      : {}),
    ...(cell.power === layer.power ? {} : { operationOverride: { power: cell.power } }),
  };
}

function cellBounds(layout: MaterialTestLayout, row: number, column: number): Bounds {
  const minX = cellX(layout, column);
  const minY = cellY(layout, row);
  return { minX, minY, maxX: minX + layout.cellWidth, maxY: minY + layout.cellHeight };
}

// The Material Test's label layout, under this card's own ids.
function labelObjects(layout: MaterialTestLayout, operationId: string): ImportedSvg[] {
  return materialTestLabelObjects(layout, operationId).map((label) => ({
    ...label,
    id: label.id.replace(/^material-test-/, 'photo-test-'),
  }));
}

function clampCount(value: number): number {
  const whole = Number.isFinite(value) ? Math.floor(value) : PHOTO_TEST_MIN_COUNT;
  return Math.max(PHOTO_TEST_MIN_COUNT, Math.min(PHOTO_TEST_MAX_COUNT, whole));
}

function clampGap(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_GAP_MM;
  return Math.max(0, Math.min(PHOTO_TEST_MAX_GAP_MM, value));
}
