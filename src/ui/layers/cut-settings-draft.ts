import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MAX_RASTER_LINES_PER_MM,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster';
import {
  DEFAULT_PERFORATION_CUT_MM,
  DEFAULT_PERFORATION_SKIP_MM,
  DEFAULT_TAB_SPACING_MM,
  imageOverscanMmFor,
  MAX_IMAGE_OVERSCAN_MM,
  MIN_PERFORATION_MM,
} from '../../core/job/operation-cut-extras';
import {
  DEFAULT_ARC_LEAD_ANGLE_DEG,
  DEFAULT_LEAD_LENGTH_MM,
  leadAngleDegFor,
  leadLengthMmFor,
  MAX_LEAD_LENGTH_MM,
  maxLeadAngleDeg,
  MIN_LEAD_ANGLE_DEG,
  MIN_LEAD_LENGTH_MM,
} from '../../core/job/laser-lead-settings';
import { DITHER_ALGORITHMS, type Layer, type LayerMode } from '../../core/scene';
import { numberField, reconciledNumberField, submittedNumber } from './cut-settings-number-field';
import { MAX_FILL_RAMP_LENGTH_MM } from './CutSettingsFillRampFields';

export type LayerPatch = Partial<Omit<Layer, 'id' | 'color'>>;
export type CutSettingsLimits = {
  readonly maxFeed?: number;
  readonly deferArtworkBounds?: boolean;
};

const MAX_KERF_OFFSET_MM = 10;
export const MAX_PASS_ANGLE_STEP_DEG = 180;
const MIN_TAB_SIZE_MM = 0.01;
const MAX_TAB_SIZE_MM = 100;
export const MAX_TABS_PER_SHAPE = 100;
export const MIN_TAB_SPACING_MM = 1;
export const MAX_TAB_SPACING_MM = 1000;
export const MAX_OVERCUT_MM = 50;
export const MAX_PERFORATION_MM = 100;

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
  const imageSettings = readImageSettingsPatch(
    data,
    layer,
    mode,
    linesPerMm,
    power,
    limits.deferArtworkBounds === true,
  );
  return {
    mode,
    ...readPowerModePatch(data, layer, mode),
    power,
    ...imageSettings,
    speed: numberField(data, 'speed', layer.speed, 1, maxFeed),
    passes: Math.max(
      1,
      Math.floor(numberField(data, 'passes', layer.passes, 1, Number.POSITIVE_INFINITY)),
    ),
    visible: data.has('visible'),
    output: data.has('output'),
    airAssist: data.has('airAssist') ? true : layer.airAssist,
    ...lineSettings,
    ...readLineExtrasPatch(data, layer, mode),
    ...readLineTabPatch(data, layer, mode),
    ...readLineLeadPatch(data, layer, mode),
    ...readImageOverscanPatch(data, layer, mode),
    ...readScanPatternPatch(data, layer, mode),
    ...readAutoOverscanPatch(data, mode),
    ...fillSettings,
    ...readFillRampPatch(data, layer, mode, power),
    ditherAlgorithm: parseDither(String(data.get('ditherAlgorithm') ?? layer.ditherAlgorithm)),
    linesPerMm,
    ...readScanOverridePatch(data, layer, mode),
  };
}

function readImageSettingsPatch(
  data: FormData,
  layer: Layer,
  mode: LayerMode,
  linesPerMm: number,
  power: number,
  deferArtworkBounds: boolean,
): LayerPatch {
  if (mode !== 'image') {
    return {
      minPower: Math.min(layer.minPower, power),
      dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
      negativeImage: layer.negativeImage,
      imageBidirectional: layer.imageBidirectional,
      passThrough: layer.passThrough,
    };
  }
  return {
    minPower: reconciledNumberField(
      data,
      'minPower',
      layer.minPower,
      0,
      deferArtworkBounds ? 100 : power,
    ),
    dotWidthCorrectionMm: reconciledNumberField(
      data,
      'dotWidthCorrectionMm',
      layer.dotWidthCorrectionMm,
      0,
      deferArtworkBounds ? 1 : dotWidthCorrectionMax(linesPerMm),
    ),
    negativeImage: data.has('negativeImage'),
    imageBidirectional: data.has('imageBidirectional'),
    passThrough: data.has('passThrough'),
  };
}

function readScanOverridePatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  if (mode === 'fill' || mode === 'image') {
    return {
      allowUncalibratedBidirectionalScan: data.has('allowUncalibratedBidirectionalScan'),
    };
  }
  if (layer.allowUncalibratedBidirectionalScan === undefined) return {};
  return { allowUncalibratedBidirectionalScan: layer.allowUncalibratedBidirectionalScan };
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

// ADR-415. The controls exist only in Cut Settings and only for their own
// process; a form without them (another process, the material wizard) leaves
// the operation's stored values untouched.
function readLineExtrasPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  if (mode !== 'line' || !data.has('perforationCutMm')) return {};
  return {
    overcutMm: numberField(data, 'overcutMm', layer.overcutMm ?? 0, 0, MAX_OVERCUT_MM),
    perforationEnabled: data.has('perforationEnabled'),
    perforationCutMm: numberField(
      data,
      'perforationCutMm',
      layer.perforationCutMm ?? DEFAULT_PERFORATION_CUT_MM,
      MIN_PERFORATION_MM,
      MAX_PERFORATION_MM,
    ),
    perforationSkipMm: numberField(
      data,
      'perforationSkipMm',
      layer.perforationSkipMm ?? DEFAULT_PERFORATION_SKIP_MM,
      MIN_PERFORATION_MM,
      MAX_PERFORATION_MM,
    ),
  };
}

// ADR-494, like the ADR-415 controls above. Spacing and At most are shown only
// for spacing, so a form without them keeps the stored values.
function readLineTabPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  if (mode !== 'line' || !data.has('tabLayout')) return {};
  return {
    tabLayout: data.get('tabLayout') === 'spacing' ? 'spacing' : 'count',
    ...(data.has('tabSpacingMm')
      ? {
          tabSpacingMm: numberField(
            data,
            'tabSpacingMm',
            layer.tabSpacingMm ?? DEFAULT_TAB_SPACING_MM,
            MIN_TAB_SPACING_MM,
            MAX_TAB_SPACING_MM,
          ),
        }
      : {}),
    ...(data.has('tabMaxPerShape')
      ? {
          tabMaxPerShape: Math.floor(
            numberField(data, 'tabMaxPerShape', layer.tabMaxPerShape ?? 0, 0, MAX_TABS_PER_SHAPE),
          ),
        }
      : {}),
    tabCutPowerPercent: numberField(
      data,
      'tabCutPowerPercent',
      layer.tabCutPowerPercent ?? 0,
      0,
      100,
    ),
  };
}

// ADR-626, like the ADR-415 controls: only a form with them changes them. An
// operation that never had leads stays without lead fields while the form
// leaves them off at their defaults, so it still matches its linked recipe.
function readLineLeadPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  if (mode !== 'line' || !data.has('leadStyle')) return {};
  const style = data.get('leadStyle') === 'line' ? 'line' : 'arc';
  const side = String(data.get('leadSide') ?? '');
  const patch = {
    leadInEnabled: data.has('leadInEnabled'),
    leadOutEnabled: data.has('leadOutEnabled'),
    leadStyle: style,
    leadLengthMm: numberField(
      data,
      'leadLengthMm',
      leadLengthMmFor(layer),
      MIN_LEAD_LENGTH_MM,
      MAX_LEAD_LENGTH_MM,
    ),
    leadAngleDeg: numberField(
      data,
      'leadAngleDeg',
      leadAngleDegFor(layer, style),
      MIN_LEAD_ANGLE_DEG,
      maxLeadAngleDeg(style),
    ),
    leadSide: side === 'outside' || side === 'inside' ? side : 'auto',
  } satisfies LayerPatch;
  return untouchedLeads(layer, patch) ? {} : patch;
}

function untouchedLeads(layer: Layer, patch: LayerPatch): boolean {
  const keys = Object.keys(UNTOUCHED_LEADS) as Array<keyof typeof UNTOUCHED_LEADS>;
  return (
    keys.every((key) => layer[key] === undefined) &&
    keys.every((key) => patch[key] === UNTOUCHED_LEADS[key])
  );
}

const UNTOUCHED_LEADS = {
  leadInEnabled: false,
  leadOutEnabled: false,
  leadStyle: 'arc',
  leadLengthMm: DEFAULT_LEAD_LENGTH_MM,
  leadAngleDeg: DEFAULT_ARC_LEAD_ANGLE_DEG,
  leadSide: 'auto',
} as const satisfies LayerPatch;

function readImageOverscanPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  if (mode !== 'image' || !data.has('imageOverscanMm')) return {};
  return {
    imageOverscanMm: numberField(
      data,
      'imageOverscanMm',
      imageOverscanMmFor(layer),
      0,
      MAX_IMAGE_OVERSCAN_MM,
    ),
  };
}

// ADR-492, like the ADR-415 extras: only a form with these controls changes them.
function readScanPatternPatch(data: FormData, layer: Layer, mode: LayerMode): LayerPatch {
  const step =
    (mode === 'image' || mode === 'fill') && data.has('passAngleStepDeg')
      ? {
          passAngleStepDeg: numberField(
            data,
            'passAngleStepDeg',
            layer.passAngleStepDeg ?? 0,
            -MAX_PASS_ANGLE_STEP_DEG,
            MAX_PASS_ANGLE_STEP_DEG,
          ),
        }
      : {};
  if (mode !== 'image' || !data.has('imageScanAngleDeg')) return step;
  return {
    ...step,
    imageScanAngleDeg: numberField(data, 'imageScanAngleDeg', layer.imageScanAngleDeg ?? 0, 0, 180),
    imageCrossHatch: data.has('imageCrossHatch'),
  };
}

// ADR-699: only a form showing the Ramp fields changes them. Ramp min power is
// the operation's Min power, which a Fill reads only for its ramp.
function readFillRampPatch(
  data: FormData,
  layer: Layer,
  mode: LayerMode,
  power: number,
): LayerPatch {
  if (mode !== 'fill' || !data.has('fillRampShown')) return {};
  const lengthMm = numberField(
    data,
    'fillRampLengthMm',
    layer.fillRampLengthMm ?? 0,
    0,
    Math.max(MAX_FILL_RAMP_LENGTH_MM, layer.fillRampLengthMm ?? 0),
  );
  const outerEdge = data.has('fillRampOuterEdge');
  // Absent means off: a form left alone adds no keys to the operation.
  return {
    ...(lengthMm === (layer.fillRampLengthMm ?? 0) ? {} : { fillRampLengthMm: lengthMm }),
    ...(outerEdge === (layer.fillRampOuterEdge === true) ? {} : { fillRampOuterEdge: outerEdge }),
    minPower: numberField(data, 'fillRampMinPower', layer.minPower, 0, power),
  };
}

// ADR-495: the switch sends nothing when off, so the form marks that it showed it.
function readAutoOverscanPatch(data: FormData, mode: LayerMode): LayerPatch {
  if ((mode !== 'image' && mode !== 'fill') || !data.has('autoOverscanShown')) return {};
  return { autoOverscan: data.has('autoOverscan') };
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

// A stored density outside the recommended range (a LightBurn recipe at a
// 0.5 mm interval stores 2 lines/mm) is what compiles, so submitting it
// unchanged keeps it; only a new entry is held to the recommended range. The
// hidden linesPerMm field carries the exact stored number beside the rounded
// visible fields, so it alone can tell an unchanged density from a new one.
function readImageLinesPerMm(data: FormData, layer: Layer): number {
  if (data.has('linesPerMm')) {
    if (submittedNumber(data, 'linesPerMm') === layer.linesPerMm) return layer.linesPerMm;
    return numberField(
      data,
      'linesPerMm',
      layer.linesPerMm,
      MIN_RASTER_LINES_PER_MM,
      MAX_RASTER_LINES_PER_MM,
    );
  }
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

function positiveFiniteLimit(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, value) : null;
}

function parseMode(value: string): LayerMode {
  if (value === 'fill' || value === 'image') return value;
  return 'line';
}

function readPowerMode(
  data: FormData,
  fallback: NonNullable<Layer['powerMode']> | undefined,
): NonNullable<Layer['powerMode']> | undefined {
  if (!data.has('powerMode')) return fallback;
  const value = String(data.get('powerMode'));
  return value === 'constant' || value === 'dynamic' ? value : undefined;
}

function readPowerModePatch(
  data: FormData,
  layer: Layer,
  mode: LayerMode,
): Pick<LayerPatch, 'powerMode'> {
  return { powerMode: mode === 'image' ? layer.powerMode : readPowerMode(data, layer.powerMode) };
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
