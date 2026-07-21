// The Image Studio adjustment catalog (ADR-242, PP-E): every Adjust/Filter
// menu entry as declarative schema (the options-bar convention) plus the
// dispatcher that runs one against a document. Parameterless entries
// (Invert, Desaturate) commit instantly; the rest open the slider dialog.

import type { PixelRect, RgbaBuffer } from '../../core/image-edit';
import type { SelectionMask } from '../../core/image-select';
import {
  applyLumaLutInPlace,
  applyLutInPlace,
  brightnessContrastLut,
  curveLut,
  gaussianBlurInPlace,
  grayscaleLut,
  halftoneScreenInPlace,
  highPassInPlace,
  invertLut,
  levelsLut,
  medianInPlace,
  posterizeLut,
  thresholdLut,
  unsharpMaskInPlace,
  type CurvePoint,
} from '../../core/image-adjust';

export type AdjustmentId =
  | 'brightness-contrast'
  | 'levels'
  | 'curves'
  | 'threshold'
  | 'posterize'
  | 'invert'
  | 'desaturate'
  | 'gaussian-blur'
  | 'unsharp-mask'
  | 'high-pass'
  | 'median'
  | 'halftone'
  | 'line-screen';

/** The identity diagonal Curves opens with. */
export const DEFAULT_CURVE_POINTS: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

export type AdjustParamSpec = {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
};

export type AdjustmentSpec = {
  readonly id: AdjustmentId;
  readonly label: string;
  /** Which top-bar menu lists it (Photoshop: Image ▸ Adjustments vs Filter). */
  readonly menu: 'adjust' | 'filter';
  /** Keyboard hint shown in the menu row; '' = none. */
  readonly shortcutHint: string;
  readonly params: readonly AdjustParamSpec[];
  /** Levels/Threshold render the luma histogram behind their sliders. */
  readonly hasHistogram: boolean;
};

const FULL_RANGE = { min: 0, max: 255, step: 1 };

const BY_ID: Record<AdjustmentId, AdjustmentSpec> = {
  'brightness-contrast': {
    id: 'brightness-contrast',
    label: 'Brightness / Contrast',
    menu: 'adjust',
    shortcutHint: '',
    hasHistogram: false,
    params: [
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  levels: {
    id: 'levels',
    label: 'Levels',
    menu: 'adjust',
    shortcutHint: 'Ctrl+L',
    hasHistogram: true,
    params: [
      { key: 'inBlack', label: 'Input black', ...FULL_RANGE, max: 254, defaultValue: 0 },
      { key: 'inWhite', label: 'Input white', ...FULL_RANGE, min: 1, defaultValue: 255 },
      { key: 'gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.01, defaultValue: 1 },
      { key: 'outBlack', label: 'Output black', ...FULL_RANGE, defaultValue: 0 },
      { key: 'outWhite', label: 'Output white', ...FULL_RANGE, defaultValue: 255 },
    ],
  },
  curves: {
    id: 'curves',
    label: 'Curves',
    menu: 'adjust',
    shortcutHint: 'Ctrl+M',
    // The point editor draws its own histogram backdrop.
    hasHistogram: false,
    params: [],
  },
  threshold: {
    id: 'threshold',
    label: 'Threshold',
    menu: 'adjust',
    shortcutHint: '',
    hasHistogram: true,
    params: [{ key: 'level', label: 'Level', ...FULL_RANGE, min: 1, defaultValue: 128 }],
  },
  posterize: {
    id: 'posterize',
    label: 'Posterize',
    menu: 'adjust',
    shortcutHint: '',
    hasHistogram: false,
    params: [{ key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, defaultValue: 4 }],
  },
  invert: {
    id: 'invert',
    label: 'Invert',
    menu: 'adjust',
    shortcutHint: 'Ctrl+I',
    hasHistogram: false,
    params: [],
  },
  desaturate: {
    id: 'desaturate',
    label: 'Desaturate',
    menu: 'adjust',
    shortcutHint: 'Ctrl+Shift+U',
    hasHistogram: false,
    params: [],
  },
  'gaussian-blur': {
    id: 'gaussian-blur',
    label: 'Gaussian Blur',
    menu: 'filter',
    shortcutHint: '',
    hasHistogram: false,
    params: [{ key: 'sigma', label: 'Radius (px)', min: 0.5, max: 50, step: 0.5, defaultValue: 2 }],
  },
  'unsharp-mask': {
    id: 'unsharp-mask',
    label: 'Unsharp Mask',
    menu: 'filter',
    shortcutHint: '',
    hasHistogram: false,
    params: [
      { key: 'amount', label: 'Amount (%)', min: 1, max: 500, step: 1, defaultValue: 100 },
      { key: 'sigma', label: 'Radius (px)', min: 0.5, max: 50, step: 0.5, defaultValue: 2 },
      { key: 'threshold', label: 'Threshold', ...FULL_RANGE, defaultValue: 0 },
    ],
  },
  'high-pass': {
    id: 'high-pass',
    label: 'High Pass',
    menu: 'filter',
    shortcutHint: '',
    hasHistogram: false,
    params: [{ key: 'sigma', label: 'Radius (px)', min: 0.5, max: 50, step: 0.5, defaultValue: 4 }],
  },
  median: {
    id: 'median',
    label: 'Median (Despeckle)',
    menu: 'filter',
    shortcutHint: '',
    hasHistogram: false,
    params: [{ key: 'radius', label: 'Radius (px)', min: 1, max: 4, step: 1, defaultValue: 1 }],
  },
  halftone: {
    id: 'halftone',
    label: 'Halftone (Dots)',
    menu: 'filter',
    shortcutHint: '',
    hasHistogram: false,
    params: [
      { key: 'spacing', label: 'Cell size (px)', min: 4, max: 64, step: 1, defaultValue: 8 },
      { key: 'angle', label: 'Angle (°)', min: 0, max: 90, step: 1, defaultValue: 45 },
    ],
  },
  'line-screen': {
    id: 'line-screen',
    label: 'Line Screen (Newsprint)',
    menu: 'filter',
    shortcutHint: '',
    hasHistogram: false,
    params: [
      { key: 'spacing', label: 'Line pitch (px)', min: 4, max: 64, step: 1, defaultValue: 8 },
      { key: 'angle', label: 'Angle (°)', min: 0, max: 90, step: 1, defaultValue: 0 },
    ],
  },
};

export const ADJUSTMENTS: readonly AdjustmentSpec[] = Object.values(BY_ID);

export function adjustmentById(id: AdjustmentId): AdjustmentSpec {
  return BY_ID[id];
}

export function defaultParams(spec: AdjustmentSpec): Record<string, number> {
  const params: Record<string, number> = {};
  for (const param of spec.params) params[param.key] = param.defaultValue;
  return params;
}

// Missing keys fall back to the spec default so a partial record never NaNs.
function p(spec: AdjustmentSpec, params: Readonly<Record<string, number>>, key: string): number {
  const fallback = spec.params.find((param) => param.key === key)?.defaultValue ?? 0;
  return params[key] ?? fallback;
}

type RunArgs = {
  readonly spec: AdjustmentSpec;
  readonly params: Readonly<Record<string, number>>;
  readonly doc: RgbaBuffer;
  readonly rect: PixelRect | null;
  readonly mask: SelectionMask | null;
};

// Record dispatch keeps each runner at trivial complexity and the compiler
// enforces totality: a new AdjustmentId without a runner fails to build.
const RUNNERS: Record<AdjustmentId, (args: RunArgs) => void> = {
  'brightness-contrast': ({ spec, params, doc, rect, mask }) =>
    applyLutInPlace(
      doc,
      brightnessContrastLut(p(spec, params, 'brightness'), p(spec, params, 'contrast')),
      rect,
      mask,
    ),
  levels: ({ spec, params, doc, rect, mask }) =>
    applyLutInPlace(doc, levelsLut(levelsFrom(spec, params)), rect, mask),
  // Custom point lists route through the session bridge; the catalog runner
  // stays total with the identity diagonal.
  curves: ({ doc, rect, mask }) => applyLutInPlace(doc, curveLut(DEFAULT_CURVE_POINTS), rect, mask),
  threshold: ({ spec, params, doc, rect, mask }) =>
    applyLumaLutInPlace(doc, thresholdLut(p(spec, params, 'level')), rect, mask),
  posterize: ({ spec, params, doc, rect, mask }) =>
    applyLutInPlace(doc, posterizeLut(p(spec, params, 'levels')), rect, mask),
  invert: ({ doc, rect, mask }) => applyLutInPlace(doc, invertLut(), rect, mask),
  desaturate: ({ doc, rect, mask }) => applyLumaLutInPlace(doc, grayscaleLut(), rect, mask),
  'gaussian-blur': ({ spec, params, doc, rect, mask }) =>
    gaussianBlurInPlace(doc, p(spec, params, 'sigma'), rect, mask),
  'unsharp-mask': ({ spec, params, doc, rect, mask }) =>
    unsharpMaskInPlace(
      doc,
      {
        amountPercent: p(spec, params, 'amount'),
        sigma: p(spec, params, 'sigma'),
        threshold: p(spec, params, 'threshold'),
      },
      rect,
      mask,
    ),
  'high-pass': ({ spec, params, doc, rect, mask }) =>
    highPassInPlace(doc, p(spec, params, 'sigma'), rect, mask),
  median: ({ spec, params, doc, rect, mask }) =>
    medianInPlace(doc, p(spec, params, 'radius'), rect, mask),
  halftone: ({ spec, params, doc, rect, mask }) =>
    halftoneScreenInPlace(doc, screenFrom(spec, params, 'dot'), rect, mask),
  'line-screen': ({ spec, params, doc, rect, mask }) =>
    halftoneScreenInPlace(doc, screenFrom(spec, params, 'line'), rect, mask),
};

/** Run one adjustment against the document (rect/mask = selection clamp). */
export function runAdjustment(
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
  doc: RgbaBuffer,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  RUNNERS[id]({ spec: BY_ID[id], params, doc, rect, mask });
}

function screenFrom(
  spec: AdjustmentSpec,
  params: Readonly<Record<string, number>>,
  shape: 'dot' | 'line',
) {
  return {
    spacingPx: p(spec, params, 'spacing'),
    angleDeg: p(spec, params, 'angle'),
    shape,
  };
}

function levelsFrom(spec: AdjustmentSpec, params: Readonly<Record<string, number>>) {
  return {
    inBlack: p(spec, params, 'inBlack'),
    inWhite: p(spec, params, 'inWhite'),
    gamma: p(spec, params, 'gamma'),
    outBlack: p(spec, params, 'outBlack'),
    outWhite: p(spec, params, 'outWhite'),
  };
}
