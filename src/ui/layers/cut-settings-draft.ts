import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster/raster-units';
import { DITHER_ALGORITHMS, type Layer, type LayerMode } from '../../core/scene';

export type LayerPatch = Partial<Omit<Layer, 'id' | 'color'>>;
export type CutSettingsLimits = {
  readonly maxFeed?: number;
};

const MAX_KERF_OFFSET_MM = 10;
const MIN_TAB_SIZE_MM = 0.01;
const MAX_TAB_SIZE_MM = 100;
const MAX_TABS_PER_SHAPE = 100;

export function readCutSettingsPatch(
  data: FormData,
  layer: Layer,
  limits: CutSettingsLimits = {},
): LayerPatch {
  const mode = parseMode(String(data.get('mode') ?? layer.mode));
  const power = numberField(data, 'power', layer.power, 0, 100);
  const maxFeed = positiveFiniteLimit(limits.maxFeed) ?? Number.POSITIVE_INFINITY;
  const linesPerMm = mode === 'image' ? readImageLinesPerMm(data, layer) : layer.linesPerMm;
  const lineSettings = readLineSettingsPatch(data, layer, mode);
  const fillSettings = readFillSettingsPatch(data, layer, mode);
  return {
    mode,
    power,
    minPower:
      mode === 'image'
        ? numberField(data, 'minPower', layer.minPower, 0, power)
        : Math.min(layer.minPower, power),
    speed: numberField(data, 'speed', layer.speed, 1, maxFeed),
    passes: Math.max(
      1,
      Math.floor(numberField(data, 'passes', layer.passes, 1, Number.POSITIVE_INFINITY)),
    ),
    visible: data.has('visible'),
    output: data.has('output'),
    airAssist: data.has('airAssist'),
    ...lineSettings,
    ...fillSettings,
    ditherAlgorithm: parseDither(String(data.get('ditherAlgorithm') ?? layer.ditherAlgorithm)),
    linesPerMm,
    dotWidthCorrectionMm:
      mode === 'image'
        ? numberField(
            data,
            'dotWidthCorrectionMm',
            layer.dotWidthCorrectionMm,
            0,
            dotWidthCorrectionMax(linesPerMm),
          )
        : layer.dotWidthCorrectionMm,
    negativeImage: mode === 'image' ? data.has('negativeImage') : layer.negativeImage,
    imageBidirectional:
      mode === 'image' ? data.has('imageBidirectional') : layer.imageBidirectional,
    passThrough: mode === 'image' ? data.has('passThrough') : layer.passThrough,
  };
}

function readFillSettingsPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  return {
    hatchAngleDeg: numberField(data, 'hatchAngleDeg', layer.hatchAngleDeg, 0, 180),
    hatchSpacingMm: mode === 'fill' ? readFillLineIntervalMm(data, layer) : layer.hatchSpacingMm,
    fillOverscanMm: numberField(data, 'fillOverscanMm', layer.fillOverscanMm, 0, 25),
    fillStyle:
      mode === 'fill' ? parseFillStyle(String(data.get('fillStyle') ?? '')) : layer.fillStyle,
    fillBidirectional: mode === 'fill' ? data.has('fillBidirectional') : layer.fillBidirectional,
    fillCrossHatch: mode === 'fill' ? data.has('fillCrossHatch') : layer.fillCrossHatch,
  };
}

function readLineSettingsPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  if (mode !== 'line') {
    return {
      kerfOffsetMm: layer.kerfOffsetMm,
      tabsEnabled: layer.tabsEnabled,
      tabSizeMm: layer.tabSizeMm,
      tabsPerShape: layer.tabsPerShape,
      tabSkipInnerShapes: layer.tabSkipInnerShapes,
    };
  }
  return {
    kerfOffsetMm: numberField(
      data,
      'kerfOffsetMm',
      layer.kerfOffsetMm,
      -MAX_KERF_OFFSET_MM,
      MAX_KERF_OFFSET_MM,
    ),
    tabsEnabled: data.has('tabsEnabled'),
    tabSizeMm: numberField(data, 'tabSizeMm', layer.tabSizeMm, MIN_TAB_SIZE_MM, MAX_TAB_SIZE_MM),
    tabsPerShape: Math.max(
      1,
      Math.floor(numberField(data, 'tabsPerShape', layer.tabsPerShape, 1, MAX_TABS_PER_SHAPE)),
    ),
    tabSkipInnerShapes: data.has('tabSkipInnerShapes'),
  };
}

export function dotWidthCorrectionMax(linesPerMm: number): number {
  return 1 / Math.max(1, linesPerMm);
}

function readFillLineIntervalMm(data: FormData, layer: Layer): number {
  if (data.has('hatchSpacingMm')) {
    return numberField(data, 'hatchSpacingMm', layer.hatchSpacingMm, 0.05, 10);
  }
  if (data.has('fillLinesPerInch')) {
    const linesPerInch = numberField(
      data,
      'fillLinesPerInch',
      25.4 / layer.hatchSpacingMm,
      2.54,
      508,
    );
    return Math.max(0.05, Math.min(10, 25.4 / linesPerInch));
  }
  return layer.hatchSpacingMm;
}

function readImageLinesPerMm(data: FormData, layer: Layer): number {
  if (data.has('imageDpi')) {
    return dpiToLinesPerMm(
      numberField(
        data,
        'imageDpi',
        linesPerMmToDpi(layer.linesPerMm),
        linesPerMmToDpi(MIN_RASTER_LINES_PER_MM),
        linesPerMmToDpi(MAX_RASTER_LINES_PER_MM),
      ),
    );
  }
  if (data.has('lineIntervalMm')) {
    return lineIntervalMmToLinesPerMm(
      numberField(
        data,
        'lineIntervalMm',
        linesPerMmToLineIntervalMm(layer.linesPerMm),
        linesPerMmToLineIntervalMm(MAX_RASTER_LINES_PER_MM),
        linesPerMmToLineIntervalMm(MIN_RASTER_LINES_PER_MM),
      ),
    );
  }
  return layer.linesPerMm;
}

function numberField(
  data: FormData,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat(String(data.get(name) ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function positiveFiniteLimit(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, value) : null;
}

function parseMode(value: string): LayerMode {
  if (value === 'fill' || value === 'image') return value;
  return 'line';
}

function parseFillStyle(value: string): Layer['fillStyle'] {
  if (value === 'island') return 'island';
  return value === 'offset' ? 'offset' : 'scanline';
}

function parseDither(value: string): Layer['ditherAlgorithm'] {
  return DITHER_ALGORITHMS.some((algorithm) => algorithm === value)
    ? (value as Layer['ditherAlgorithm'])
    : 'floyd-steinberg';
}
